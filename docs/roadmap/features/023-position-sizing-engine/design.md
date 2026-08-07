# Design: position-sizing-engine

**Created**: 2026-08-05
**Rounds**: 5 (full; termination: approved at round-5 hard cap, scope narrowed per user decision)
**Approved by**: user @ 2026-08-05
**Grounded in**: recon.md

---

## Chosen Approach

`ComputePositionSize` is a new unexported function in `services/xstockstrat-trading/internal/service/trading.go`,
wired into `PlaceOrder`'s existing statement sequence. This design is **backend-only** — all UI wiring
explored in round 5 is deliberately dropped from this feature's scope (see Rejected Alternatives) and
lives instead in the named follow-up feature `110-wire-signal-confidence-to-position-sizing`.

**Reachability fix (Step 0).** `internal/handler/trading.go:35-37` currently rejects `qty <= 0` with
`InvalidArgument` before `TradingService.PlaceOrder` (`trading.go:242`) ever runs — recon flagged this
as the feature's headline blocker. Delete this guard; both the Connect-served and gRPC-served paths
(`grpcTradingAdapter.PlaceOrder`, `trading.go:119-125`, calls the same handler method) inherit the fix.

**Proto addition (Step 0b).** Add `optional double confidence = 16;` to `PlaceOrderRequest`
(`packages/proto/trading/v1/trading.proto`, after `trail_percent = 15`, the current highest field).
`optional` (not a bare scalar) because `confidence = 0.0` is a real, distinct value under FR-2's
formula (sizes to zero shares) that must be distinguishable from "caller never set this" — per the
repo's own precedent (`docs/roadmap/ledger/insights.md`, 2026-07-24, `cooldown_days`). Comment on the
field mirrors that precedent: "unset → confidence=1.0 (full size); explicit 0.0 → size to zero;
out-of-range → InvalidArgument." Additive field on an existing message = 1 service owner approval
(non-breaking), not the 2-owner gate. Regenerate via `./scripts/buf-gen.sh`; `buf lint`/`buf breaking`
must pass clean (Constitution **C-09**).

**Full `PlaceOrder` statement order:**
```
0.  internal/handler/trading.go: delete the qty<=0 InvalidArgument guard (lines 35-37).
0b. trading.proto: add optional double confidence = 16 to PlaceOrderRequest; buf-gen.sh; buf lint/breaking clean.
1.  maintenance-mode check                          (unchanged, trading.go:244-246)
2.  trailing-stop validation                         (unchanged, trading.go:251-259)
3.  resolveAccount(req.AccountId)                    (unchanged position, trading.go:262)
4.  mode := s.resolveTradingMode(req.TradingMode)    (moved up from trading.go:271)
5.  sizingEnabled := s.cfgW.GetBool("trading.risk.sizing_enabled", true)
    needSizing := req.Qty <= 0
    if needSizing && !sizingEnabled: return error (AC4)
6.  needRiskCheck := req.UserId != "" && s.cfgW.GetFloat("trading.risk.max_position_pct", 0.05) > 0
    if needSizing || needRiskCheck:
        equity, equityErr := s.resolveAccountEquity(ctx, req.AccountId)  // single ListPortfolios call,
                                                                          // shared by steps 7 & 8
    else: equity, equityErr = 0, nil
7.  if needSizing:
        if equityErr != nil || equity <= 0: return error (fail-closed)
        confidence := 1.0
        if req.Confidence != nil { confidence = *req.Confidence }
        if confidence < 0.0 || confidence > 1.0: return InvalidArgument (fail-closed, FR-2 domain)
        sizedQty, stopPrice, dollarRisk, err := s.ComputePositionSize(ctx, req, mode, equity, confidence)
        if err != nil: return error, order never created (fail-closed)
        req.Qty = sizedQty   // LOAD-BEARING mutation; buildBrokerRequest (step 11) depends on this.
                             // Comment required at the call site: any reorder of steps or new
                             // pre-step-7 read of req.Qty must account for this contract.
        slog.Info("position sized", symbol, sizedQty, stopPrice, dollarRisk, equity, confidence,
                   max_risk_per_trade_pct, atr_multiplier, max_concentration_pct)   (FR-7)
8.  if needRiskCheck:
        s.checkPortfolioRisk(ctx, req, mode, equity, equityErr)  // signature change: takes equity+
        // equityErr as params instead of calling GetPortfolio itself; reuses step 6's ListPortfolios
        // result — fixes the C-10(b) two-equity-sources gap. Remains warn-only/non-blocking
        // (unchanged from trading.go:1304-1326). Now evaluates the REAL (possibly sized) req.Qty,
        // fixing the round-1-found bug where it structurally could never fire for auto-sized orders.
9.  approval threshold check                          (unchanged code, trading.go:274-277) —
    now structurally meaningful for auto-sized orders since req.Qty holds the real quantity.
10. order construction + informational StopPrice for MARKET/LIMIT orders only (never for
    STOP/STOP_LIMIT/TRAILING_STOP — those keep req.StopPrice, their real broker-trigger price, untouched)
11. buildBrokerRequest(req) — automatically correct since req.Qty was mutated in place at step 7
```

**`ComputePositionSize` internals.** For both `marketdata.GetBars` and `marketdata.GetLatestQuote`:
check `err != nil` FIRST (both have real-error sub-paths — `GetLatestQuote`'s live-fetch path,
`marketdata_service.go:367-370`; `GetBars`' DB-query path, `marketdata_service.go:155-158` — neither
is uniformly "empty but valid" on failure), THEN check response shape (`len(bars) < 15` for Wilder
ATR(14)'s minimum bar requirement; zero quote) as a separate fail-closed condition for the
valid-but-insufficient case. Both external calls share one 2-second timeout budget (matching
`checkPortfolioRisk`'s existing `context.WithTimeout(ctx, 2*time.Second)` pattern,
`trading.go:1297`), not two independent budgets.

Current price: `(ask_price + bid_price) / 2` from `GetLatestQuote`, falling back to whichever of
ask/bid is nonzero; fail-closed if both are zero (`Quote` has no single current-price field,
`marketdata.proto:60-68`).

ATR: true Wilder ATR(14), computed in Go from `marketdata.GetBars(TIMEFRAME_1DAY)` high/low/close —
not via `xstockstrat-indicators`' `_atr` (`indicators_engine.py:103-109`), which is a close-only
approximation, not Wilder's true-range formula. Formula: `TR_i = max(high_i - low_i,
|high_i - close_{i-1}|, |low_i - close_{i-1}|)`; ATR = Wilder's exponential smoothing over 14 periods
(first value = simple mean of first 14 TRs, then `((prevATR × 13) + TR_i) / 14`).

Equity: `resolveAccountEquity(ctx, accountID)` — a new helper wrapping a single
`ListPortfolios(AccountId: ...)` call (`portfolio.proto:17`, `buildAccountPortfolio.Equity`,
`portfolio_service.go:947-983`) — not `GetPortfolio.Equity` (`portfolio_service.go:440-459`), which
sums only open-position market value and is `$0` for a flat, freshly-funded account (AC-1's exact
scenario). A never-synced account (before its first ~5-minute broker-balance sync) also reads as
`equity <= 0` and is treated as a hard, fail-closed rejection — FR-6's override mode (explicit qty)
remains a working escape hatch for such an account's first order, since it never calls the equity RPC.

`max_position_pct` (existing, 5%, warn-only, in `checkPortfolioRisk`) and `max_concentration_pct`
(new, 10%, enforcing, in `ComputePositionSize`) coexist because they now cover disjoint order
populations: the enforcing cap only runs for auto-sized orders; the warn-only check is the *only*
concentration signal an override-mode (explicit-qty) order ever sees, since such orders bypass sizing
entirely. Retiring `max_position_pct` would leave override-mode orders with zero concentration
guardrail.

**Confidence.** `PlaceOrderRequest.confidence` defaults to `1.0` when unset (full size — a true no-op
for all current traffic, since FR-6 confirms the trader UI, the only live `PlaceOrder` caller, always
sends `qty > 0` and therefore never reaches the sizing branch that reads `confidence` at all). No proto
change beyond the field itself is needed for this feature — the value is consumed correctly by
`ComputePositionSize` regardless of whether any caller populates it yet. **No caller populates it in
this feature's scope** — see Open Risks and Rejected Alternatives.

**Consumer surface (C-14).** This feature is internal/backend-only for the `confidence` field itself —
no UI change ships in this feature. The pre-existing FR-7 commitment (the `/trader` order-placement
flow displays the computed quantity/dollar-risk/stop-price per the approved product-spec) is
unaffected by dropping the confidence-wiring UI work; `/trader`'s display-only obligation was never
about confidence input, only about showing the *result* of a sizing decision.

## Rejected Alternatives

- **Mutate `req.Qty` via a separately-threaded `sizedQty` variable instead of in-place** — rejected:
  `req` is already a pointer read by all three downstream call sites (order construction, approval
  check, `buildBrokerRequest`); threading a parallel variable is strictly more code for no additional
  safety, since every site already dereferences `req`.
- **Leave `checkPortfolioRisk` on its original `GetPortfolio.Equity` source, separate from
  `ComputePositionSize`'s equity call** — rejected: reproduces the exact C-10(b) pattern from
  `fails.md` 2026-07-01 (two RPCs computing "equity" for two risk gates on the same order, disagreeing)
  and leaves the warn-only check structurally unable to fire for auto-sized orders (it would still
  evaluate `req.Qty` before sizing ran). The small touch (unify onto one call) is cheaper than a third
  recurrence of that ledger pattern.
- **Route ATR through `xstockstrat-indicators`** — rejected: `_atr` is a documented close-only
  approximation, not Wilder's true-range formula; routing through it would still require `trading` to
  fetch bars from `marketdata` first, then hop to indicators for a strictly worse computation.
- **Extend the indicators proto to accept high/low/close and fix `_atr` there instead** — rejected:
  architecturally cleaner (single source of truth) but is itself a proto change, adding governance
  overhead the V1 feature doesn't need when trading can compute correct ATR in-process.
- **Fail-open on missing portfolio/price/ATR data (matching `checkPortfolioRisk`'s existing stance)** —
  rejected: `checkPortfolioRisk` is advisory (a log line); `ComputePositionSize` is the *sole source*
  of quantity for an auto-sized order, so failing open would mean fabricating a risk-blind quantity —
  the opposite of this feature's purpose.
- **Check only response shape (`len(bars)`, zero quote), skip `err != nil` checks, on the theory both
  marketdata RPCs degrade to empty-but-valid on failure** — rejected: verified false for
  `GetLatestQuote` (a real Go error/nil response on live-fetch failure) and for `GetBars`' DB-query
  sub-path; shape-only checking risks a nil-pointer panic on exactly the outage this feature must
  survive.
- **Hardcode `confidence = 1.0` permanently, treating confidence-scaling as out of V1 scope with no
  wire capability at all** — rejected by the user: explicitly decided to add the proto field now,
  making FR-2 reachable once a real caller exists, rather than leaving the wire incapable of it.
- **Wire `Opportunity.conviction` (the value already fetched/rendered on the signal-detail page) as
  the confidence source, with a `SignalOrderTicket` → `OrderForm` UI change in this same feature** —
  rejected after round 5's adversary found this to be a genuine semantic mismatch:
  `Opportunity.conviction` is explicitly documented ("a deterministic ordinal... **NOT a probability**")
  as a different kind of value than FR-2's "signal confidence." The correct source,
  `ExternalSignal.conviction`, is never surfaced in the UI today and needs real new plumbing — deferred
  to the named follow-up feature below rather than substituted with a convenient-but-wrong proxy.
- **Make the trader UI's qty field optional globally (all three `OrderForm` render sites), not just the
  signal ticket** — rejected: from the plain `/trader`/`/trader/orders` forms, no confidence value
  would ever be available, so a trader leaving qty blank there would silently get maximum-risk sizing
  (`confidence` defaulting to 1.0) with zero UI indication that auto-sizing happened or why. The
  narrower, surface-scoped affordance (signal ticket only) avoids this; it is now the follow-up
  feature's design question, not resolved here.
- **Ship the full UI wiring (round 5's proposal) in this same feature** — rejected by explicit user
  decision at the round-5 gate ("Drop UI wiring this round, ship backend-only") after the round-5
  adversary found three unresolved issues (C-14 surface-naming gap, the semantic mismatch above, and
  the silent-max-risk UI gap). Deferred to the **named** follow-up feature
  `110-wire-signal-confidence-to-position-sizing` — satisfying Constitution **C-14**'s requirement
  that a deferred surface point at a named feature, never a vague "later."

## Open Risks

- [ ] `PlaceOrderRequest.confidence` ships with no populating caller until
  `110-wire-signal-confidence-to-position-sizing` lands — FR-2's confidence-scaling formula is
  reachable and unit-testable but not exercised by any real caller in this feature's scope. To be
  addressed by feature 110.
- [ ] `Signal.conviction` (`ExternalSignal.conviction`, `packages/proto/ingest/v1/ingest.proto:110`) is
  the semantically-correct confidence source but is never surfaced in `xstockstrat-ui` today — real
  plumbing work belongs to feature 110, not this one.
- [ ] `GetBars`'s exact `TimeRange`/pagination semantics for reliably yielding ≥15 daily bars were not
  verified in depth against `marketdata_service.go`'s full `GetBars` implementation — confirm at
  `/sdd-spec`.
- [ ] `docker-compose.yml`'s trading `depends_on` block needs a new `xstockstrat-marketdata: condition:
  service_started` entry (matching the existing `xstockstrat-portfolio` precedent) since the new
  marketdata client is now a hard synchronous dependency for every auto-sized order — to be added at
  `/sdd-spec`.
- [ ] No test in `xstockstrat-trading` has ever mocked a gRPC client dependency; the first test
  (`internal/service/trading_sizing_test.go`) will need inline fake structs implementing the generated
  `PortfolioServiceClient`/`MarketDataServiceClient` interfaces (no `internal/testdata/` yet — Go's
  C-13 fixture home materializes only on the second consumer) — to be built at `/sdd-spec`/`/sdd-execute`.

## Constitution Rules Touched

- **C-01** (zero-assumption/evidence-cited) — honored by: every design decision above cites a
  `recon.md`-grounded `path:line`; the round-2/3/4/5 adversary passes specifically caught and
  corrected two false absence-claims (the "both marketdata RPCs fail empty-but-valid" claim, and the
  original "doc/code key-name drift" claim from feature 100's unrelated review) before they could ship.
- **C-05** (config key naming) — honored by: all four new keys (`trading.risk.max_risk_per_trade_pct`,
  `atr_multiplier`, `max_concentration_pct`, `sizing_enabled`) follow `<service>.<category>.<key>`.
- **C-08**/**P-06** (test pairing, red-before-green) — honored by: `/sdd-spec` will pair each service
  step with a test step per the Open Risks item on gRPC client mocking above.
- **C-09** (proto verification) — honored by: Step 0b requires `./scripts/buf-gen.sh` and clean
  `buf lint`/`buf breaking` before the proto change is considered complete.
- **C-10** (integration completeness across shared/duplicated surfaces) — honored by: unifying
  `checkPortfolioRisk` and `ComputePositionSize` onto one equity source (C-10(b), fixes a would-be
  recurrence of the 2026-07-01 056-open-positions-ui pattern); C-10(a)/(c) not triggered (no new UI
  page, no new shared/seeded resource).
- **C-11** (no implementation without minimum SDD grounding) — honored by: this feature ran the full
  pipeline (`/sdd-story` → `/sdd-review product-spec` (3 rounds to PASS) → `/sdd-design` full mode, 5
  rounds) before any implementation write.
- **C-14** (name the consumer surface) — honored by: the pre-existing `/trader` display surface from
  product-spec.md is preserved; the newly-discovered `/insights` surface and the confidence-input gap
  are **not** silently dropped — they're captured in the named follow-up feature 110, satisfying C-14's
  explicit requirement that a deferred surface point at a named feature.
- **P-01** (single-orchestrator authority) — honored by: all five design-proposer/design-adversary
  subagent rounds were read-only and advisory; every write (recon.md, this file, feature.md,
  context.md) is by the orchestrating skill only.
- **P-02** (no lateral subagent coordination) — honored by: each adversary round received only the
  orchestrator's synthesized state from the prior round, never the previous adversary's raw output.
- **P-03** (no silent deviation) — honored by: the round-4 adversary's "vague deferral" objection on
  the confidence field was not silently accepted — it produced a genuine user decision and a named
  follow-up feature, not a paper-over.
- **P-04** (phase-gate approval, recorded) — honored by: every round's synthesis was gated through
  `AskUserQuestion`; this design.md and the COMPLETION step's feature.md/context.md updates record the
  approval.
- **F-11** (Floor rejection halts) — honored by: no Floor breach was ever flagged across all five
  rounds; nothing here required a halt.
