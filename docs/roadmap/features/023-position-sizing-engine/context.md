# Context: position-sizing-engine

**Feature**: `docs/roadmap/features/023-position-sizing-engine/feature.md`
**Product Spec**: `docs/roadmap/features/023-position-sizing-engine/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/023-position-sizing-engine/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 023.
- No proto or schema changes in V1. Internal function in trading service.
- Key design decision: explicit-quantity orders bypass sizing (backward compatibility with agent tool calls).
- Two open questions deferred to /sdd-spec: ATR source (marketdata vs. indicators), and whether to expose ComputePositionSize as a gRPC RPC in V1.
- Platform Lead added as reviewer given cross-service dependency (trading → portfolio → marketdata/indicators).

## Session 2026-08-04T00:00:00Z — sdd-story (priority amendment)

- An external live-capital safety risk review recommended this feature be promoted to `P0` and
  accelerated to the top of the roadmap: "Every order should be server-sized. Do not accept a
  client-provided quantity as authoritative for automated strategies." Priority annotation added to
  `feature.md`; no lifecycle status change (still `draft`, pending `/sdd-review`).
- The review calls for controls beyond the current FR-1..FR-8 scope. Recorded here as **additional
  requirements to fold in at the next `/sdd-design`/`/sdd-spec` pass** — not silently added to the
  Functional Requirements above, since several are genuine design forks (behavior #1, "don't guess"):
  - Maximum gross and net exposure limits (account-wide, not just per-position concentration).
  - Per-symbol and correlated-sector concentration limits (current FR-3 is single-position only).
  - Buying-power and available-cash validation before sizing (not currently checked).
  - Minimum stop distance and maximum tolerated stop distance (current spec has no bounds on ATR-
    derived stop distance).
  - Rejection of zero, negative, NaN, stale, or implausible prices feeding the sizing formula.
  - Separate limits for paper and live environments (current spec applies one set of config keys to
    both — `docs/runbooks/feature-workflow.md` already hardcodes paper/live at the infra level via
    `TRADING_MODE`, but the risk *limits themselves* are not yet environment-scoped).
  - Lower limits for newly-enabled strategies (a strategy-age/maturity dimension, not present today).
  - A persisted `RiskDecision` record for every automated live order (inputs, applicable limits,
    result, reason codes) — the current spec only requires INFO-level logging (FR-7), not a queryable
    persisted decision record.
  - Concurrency safety: concurrent orders must not each individually pass checks and collectively
    exceed a limit (current spec has no stated concurrency invariant).
  - Fail-closed behavior when portfolio, price, or configuration data is unavailable (not stated
    today).
  - Risk rejection must occur **before** any broker API call (implicit in the current design via
    `ComputePositionSize` running pre-submission, but not stated as an explicit invariant/AC).
  - This feature now also gates on the new **feature 106 (market-data-freshness-and-quality-gate)**
    and enforces alongside the new **feature 100 (account-trading-halt-and-kill-switch)** at the same
    trading-service order-path enforcement point — sequence these together at `/sdd-design`.
- New backlog features created from the same review: 100–109 (see
  `docs/roadmap/features/100-account-trading-halt-and-kill-switch/` through
  `109-live-trading-game-day/`). This feature and 030 remain the two existing drafts the review said
  to accelerate rather than duplicate.

## Session 2026-08-04T01:00:00Z — feasibility re-check (fold-in from demoted 106)

- A feasibility re-check demoted `106-market-data-freshness-and-quality-gate` (see its context.md) as
  disproportionate to build as a standalone service/proto surface right now. Its cheap, genuinely
  valuable core survives as a recommendation for **this** feature's own implementation: when 023 builds
  its real sizing engine, `ComputePositionSize` (or its replacement) should reject on a missing, zero,
  negative, NaN, or stale price **as part of its own input validation** — reusing the live quote/equity
  read that `checkPortfolioRisk` (`services/xstockstrat-trading/internal/service/trading.go:1288`)
  already performs — rather than standing up a separate market-data-quality service. Note also that
  `checkPortfolioRisk` is currently **deliberately fail-open** ("portfolio unavailability must not halt
  trading," `trading.go:1288` comment) — 023's design should explicitly decide whether the new sizing
  engine keeps that fail-open stance or flips to fail-closed per the review's recommendation; either is
  defensible, but the current behavior is a considered prior choice, not an oversight, and reversing it
  has a real cost on this single-instance-no-HA topology (a portfolio-service blip would then block all
  new orders).

## Session 2026-08-05T00:00:00Z — sdd-review product-spec (3 rounds)

- Round 1 FAIL: (1) missing `## Consumer Surface(s)` section (C-14); (2) `trading.risk.max_concentration_pct`
  duplicated the existing warn-only `trading.risk.max_position_pct` (`trading.go:1288-1326`) without
  reconciliation (C-10); (3) unresolved Open Questions. Fixed: added the Consumer Surface(s) section
  (`/trader` order flow), named the reconciliation as an explicit `/sdd-design` question rather than
  silently leaving two overlapping risk knobs, stated the `qty<=0` auto-size convention, corrected the
  FR-6 agent-tool-call claim (no agent order-placement tool exists today), added OrderType/AC
  clarifications.
- Round 2 FAIL: two internal contradictions — FR-2's `confidence_multiplier` was undefined for
  confidence < 0.5 (half the valid input domain); FR-7 required returning the sizing decision "in the
  order-placement response" while Proto Contract Changes claimed no proto changes were needed (verified
  false — `Order` has no dollar-risk field). Fixed: `confidence_multiplier = confidence` (linear
  identity across the full 0.0–1.0 domain); FR-7 scoped down to quantity/stop-price via the existing
  unchanged `Order.qty`/`Order.stop_price` fields, dollar risk and inputs log-only in V1 (genuinely no
  proto change needed).
- Round 3: **PASS WITH WARNINGS** (3 advisory: FR-5/FR-6 don't state the interaction between
  `qty<=0` auto-sizing and STOP/STOP_LIMIT/TRAILING_STOP orders with an unset trigger price; FR-7's
  reuse of `Order.stop_price` for a computed, non-broker-real risk value overloads a field whose only
  current semantics is "the real working broker stop" — flag for `/sdd-design`; cosmetic unchecked
  boxes). Status: `draft` → `spec-ready`.

## Session 2026-08-05T00:00:00Z — sdd-design (full mode, 5 rounds)

- Phase 0 Recon: wrote `recon.md` (services: trading, portfolio, marketdata, config, ui). Found a
  new blocker recon flagged that the product-spec review hadn't caught: the served gRPC handler
  (`internal/handler/trading.go:35-37`) rejects `qty<=0` before the service layer runs — FR-5's
  auto-size trigger was unreachable as speced. Also found two divergent portfolio equity sources, no
  true ATR anywhere in the codebase, no current-price field on `Quote`, and no existing
  trading→marketdata client.
- Round 1: proposer/adversary found the design sound on TRADING-1 (verified: deleting the handler
  gate is safe) but flagged 3 real gaps: an unspecified quantity write-back path (safety-critical —
  the computed quantity could silently never reach the broker or the approval-threshold check), the
  equity source being $0 for a flat account, and the warn-only `max_position_pct` check structurally
  unable to fire for auto-sized orders.
- Round 2: resolved all round-1 gaps (mutate `req.Qty` in place; unify `checkPortfolioRisk` and
  `ComputePositionSize` onto one `ListPortfolios` equity call, reordering `checkPortfolioRisk` to run
  after sizing). Self-flagged a new risk: `PlaceOrderRequest` has no `confidence` field, so every
  auto-sized order would hardcode `confidence=1.0`.
- Round 3: fixed 2 of 3 round-2 objections (the handler-gate deletion had dropped out of the
  restated design; the "both marketdata RPCs fail empty-but-valid" claim was verified FALSE for
  `GetLatestQuote` — real error, not empty response — risking a nil-pointer panic). Resolved
  confidence by hardcoding `1.0`, flagged as a prominent Open Risk rather than a footnote — the
  adversary's follow-up called this insufficient (C-11/P-03: a genuine design fork decided
  unilaterally rather than raised).
- **User override (via a screenshot, not the AskUserQuestion tool)**: explicitly chose "add the
  confidence field to the proto now" over hardcoding 1.0 or shipping unwired — expanding V1 scope
  past the product-spec's original "no proto changes" line, because it makes FR-2 actually reachable.
- Round 4: added `optional double confidence = 16` to `PlaceOrderRequest` (per the repo's own
  `optional`-for-meaningful-zero precedent, `insights.md` 2026-07-24). The adversary found this
  shipped as a vague C-14 deferral ("a future feature would add a real caller") and pointed out the
  design never named the one already-wired candidate, `ExternalSignal.conviction`.
- **User decision**: expand scope further — wire a real value into `confidence` within this same
  feature.
- A dedicated recon pass corrected a factual error before round 5 ran: the natural UI wiring point
  is actually `Opportunity.conviction` (already fetched/rendered on the signal-detail page), not
  `ExternalSignal.conviction` (never surfaced in the UI at all, would need new plumbing).
- Round 5 (mode cap): proposed wiring `Opportunity.conviction` through `SignalOrderTicket` →
  `OrderForm`, with qty made optional on **all three** `OrderForm` render sites. The final adversary
  pass (APPROVE WITH NOTED OPEN RISKS, no Floor breach) found 3 real problems: (1) `/insights` is an
  unnamed C-14 consumer surface; (2) `Opportunity.conviction` is explicitly documented in its own
  proto comment as "a deterministic ordinal... **NOT a probability**" — a genuine semantic mismatch
  with what `confidence` needs, `ExternalSignal.conviction` being the actual correct source; (3)
  making qty optional globally would silently max-risk-auto-size orders on the plain `/trader` form
  with zero UI indication.
- **Final user decision at the round-5 gate**: drop all UI wiring from 023's scope; ship
  backend-only (rounds 1-4's design, confidence field defaults to 1.0, correctly consumed but
  unpopulated by any caller in this feature). Created **named follow-up feature**
  `110-wire-signal-confidence-to-position-sizing` (satisfying C-14's requirement that a deferred
  surface point at a named feature, not a vague "later") to carry the real `ExternalSignal.conviction`
  plumbing and the scoped (signal-ticket-only) blank-qty UI affordance.
- Chosen approach: backend-only `ComputePositionSize`, wired into a reordered `PlaceOrder`, with the
  handler-gate deletion, unified equity source, fail-closed error handling, true Wilder ATR, and the
  `confidence` proto field (unpopulated in this feature). Rejected: hardcoded confidence, UI wiring in
  this feature, global qty-optionality, indicators-routed ATR, fail-open sizing.
- Constitution rules touched: C-01, C-05, C-08/P-06, C-09, C-10, C-11, C-14, P-01, P-02, P-03, P-04,
  F-11 (all honored — see design.md § Constitution Rules Touched). No unresolved Floor breach across
  any of the 5 rounds.
- Status: `spec-ready` → `design-approved`.

## Session 2026-08-06T18:34:00Z — sdd-spec

- Generated implementation-spec.md with 12 steps. Status → implementation-ready.
- Key codebase findings (beyond what recon.md/design.md already captured):
  - `resolveAccount` (`trading.go:188-209`) never returns the resolved account ID on its single-broker
    convenience path (`brokerPoolEntry` has no account-id field) — `ComputePositionSize`'s
    `ListPortfolios(AccountId: ...)` equity lookup needs a concrete ID even when the caller leaves
    `PlaceOrderRequest.account_id` empty. Resolved by widening `resolveAccount`'s signature to
    `(string, brokerPoolEntry, error)` (Step 6) — a minimal, necessary corollary of the equity-unification
    design, not scope creep, since without it the single-account convenience path can't be sized.
  - `GetBars`' `ORDER BY time ASC LIMIT` semantics resolve design.md's Open Risk item: an unbounded
    request (page size only) returns the **oldest** N bars in the default (wide) lookback window, not
    the most recent — reliably getting the latest 15 daily bars requires an explicit tight `Range`
    (45 calendar days back) with a `PageSize` (40) comfortably above the expected in-window bar count.
  - `OrderSide` direction was not addressed by design.md's pseudocode: stop price must be
    `currentPrice - stopDistance` for BUY (long), `currentPrice + stopDistance` for SELL (short) —
    resolved from `OrderSide` enum semantics (`trading.proto:55-58`), flagged explicitly in the spec's
    Codebase Evidence for `/sdd-review impl-spec` to check.
  - The Step 5/9 Go unit tests land in `internal/service`, a package excluded from this service's CI
    Go coverage `COVERPKGS` computation (spec-template.md's exclusion list) — noted explicitly per
    spec-template's instruction rather than claiming a coverage percentage that doesn't apply.
  - `services/xstockstrat-marketdata/cmd/server/main_test.go:33-46`
    (`TestNewFundamentalsSource_AlwaysNonNil`) is the citable precedent for both the zero-value
    `*config.Watcher` safety and the "construction canary" test pattern reused in Steps 5/7.

## Session 2026-08-06T04:00:00Z — sdd-review impl-spec (advisory)

- Result: 0 blockers, 2 warnings, 5 notes (advisory — did not block; no Floor `F-*` risk found).
  Essentially every `path:line` citation across all 12 steps verified exact against the codebase.
- **Deviation Log note (P-03)**: Step 6's implemented `ComputePositionSize` signature silently
  diverges from design.md's user-approved pseudocode (`design.md:53`) — it drops the `mode
  commonv1.TradingMode` parameter and reorders the return values (spec: `qty, dollarRisk,
  stopPrice, err`; design: `sizedQty, stopPrice, dollarRisk, err`). Internally self-consistent
  with Step 8's usage, and `mode` is genuinely unused by the `GetBars`/`GetLatestQuote`/
  `ListPortfolios` calls this function makes, so functionally low-risk — but unlike the
  `resolveAccount` widening (which the spec explicitly justified), this departure from the
  approved design was never surfaced anywhere until this review caught it. Recording here per
  P-03 ("no silent deviation"); no code change needed unless a future caller actually needs
  `mode`-dependent sizing behavior.
- Overlap scan: **real collisions found**, both now recorded in `docs/roadmap/features/merge-order.md`:
  - Migration `011` collision with `100-account-trading-halt-and-kill-switch` (both independently
    claimed `011` off a `010` tip). Resolved: 100 keeps `011_platform_trading_state` (specced
    first), this feature renumbered to `012_trading_risk_sizing` throughout Step 1 — files,
    instructions, and verification all updated in this session.
  - Same-function overlap: this feature is a third party in the `trading.go` `PlaceOrder`
    insertion-point collision already tracked for 100↔101 (Step 8's sizing gate claims the same
    `resolveAccount`→`checkPortfolioRisk` slot); also independently widens `resolveAccount`'s
    signature (Step 6, omitting the `CancelOrder` call site that 101's spec already covers), and
    edits `checkPortfolioRisk`'s body/line span that 100's Step 7 anchors to by line number.
    Revised program build order (confirmed 2026-08-06): 100 → 101 → 023 → 030 → 102 — this
    feature executes after both 100 and 101 and rebases against their landed `trading.go`,
    including reusing 101's more complete `resolveAccount` call-site coverage.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 3: `**Files**` lists `packages/proto/gen/{go,python,ts}/trading/v1/` as directories, not
    exact file paths — structurally inherent to proto codegen regeneration, not a real defect. — [ ] unaddressed
  - Step 6: `ComputePositionSize` signature divergence from design.md — see Deviation Log note
    above; no code change required unless `mode` becomes load-bearing later. — [ ] unaddressed
- Overlap findings: migration `011`→`012` renumbering applied directly to this spec (see above);
  trading.go 3-way collision recorded in merge-order.md (see above).
