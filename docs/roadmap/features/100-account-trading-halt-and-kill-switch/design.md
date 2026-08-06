# Design: account-trading-halt-and-kill-switch

**Created**: 2026-08-06
**Rounds**: 5 (full; termination: approved at round-5 hard cap, with noted open risks)
**Approved by**: user @ 2026-08-06
**Grounded in**: recon.md

---

## Chosen Approach

Add a **new parallel config key**, `platform.trading_state` (string enum `ACTIVE`/`REDUCE_ONLY`/`HALTED`),
seeded per-`trading_mode` (independent `paper`/`live` rows, following `marketdata.alpaca.paper`'s
existing pattern, `services/xstockstrat-config/migrations/002_config_environment.up.sql:65-66`) — not
a widened `platform.maintenance_mode`. Widening the existing bool key in place was **rejected**: `
ConfigValue` is a proto `oneof`, and `Watcher.GetBool` (`services/xstockstrat-trading/internal/config/config.go:162-170`)
returns the oneof's zero value (`false`) on a type mismatch, never an error — an old trading binary
reading a row migrated to `value_type='string'` mid-rollout would read the kill switch as **not
halted**, fail-*open* in exactly the wrong direction for a kill switch. `platform.maintenance_mode`
stays completely untouched, permanently — it's the platform's existing SEV-1 break-glass lever,
embedded in six live runbooks/templates, and remains a second, independent, unaffected check.

**Gate placement.** `PlaceOrder`'s existing `platform.maintenance_mode` check
(`services/xstockstrat-trading/internal/service/trading.go:244-246`) is extended with the new
`platform.trading_state` check at the same position for `HALTED`. The `REDUCE_ONLY` check — which
needs to know the account's current position to distinguish exposure-increasing from
exposure-reducing orders — runs after `resolveAccount` (`trading.go:262`) resolves
`accountEntry.userID`, calling the existing `PortfolioService.GetPosition` RPC
(`packages/proto/portfolio/v1/portfolio.proto:12`) rather than `req.UserId` (which can be empty for
system-triggered callers; `resolveAccount` always yields a real `userID` or errors first). `ReplaceOrder`
gets the identical gate via a new, factored-out `isReplaceRiskReducing` method (a pure local comparison
of `req.Qty` against the already-loaded `order.Qty`/`order.Side` — no RPC needed). `CancelOrder`
(`trading.go:387-427`) is **deliberately, permanently ungated** by this feature's check — matching
feature 030's own decision to leave `CancelOrder` ungated for its separate per-account halt, for the
identical reason: it is the operator's sole remaining manual de-risk tool.

**REDUCE_ONLY fail-closed on GetPosition uncertainty.** A confirmed `NotFound` (zero position) means
the order is definitionally exposure-increasing → blocked. Any *other* `GetPosition` error (Internal,
Unavailable, timeout) also **fails closed** (blocks the order, with a distinct error message
distinguishing "unable to verify risk-reducing status" from an ordinary halt rejection) — a deliberate
divergence from `checkPortfolioRisk`'s existing fail-open philosophy (`trading.go:1285-1287`), because
this gate *is* the enforcement point, not an advisory warning. This is accepted as the correct
trade-off for a hard kill-switch gate, with a named, unresolved Open Risk below (the adversary raised
a real, not-fully-mitigated concern that this creates a new hard dependency defeating REDUCE_ONLY's own
purpose during a correlated portfolio outage).

**`GetPosition`'s error-code contract is fixed at the source**, since verified to have exactly two
current callers, both confirmed unaffected: `xstockstrat-portfolio`'s own `processOrderFill`
(`internal/service/portfolio_service.go:257`, discards the error, branches only on nil), and
`xstockstrat-ui`'s Position-detail page via the trader BFF (`traderBff.ts:90-98` →
`usePortfolio.ts:65-83` → `page.tsx:149-150`, renders `error.message` generically, no status-code
branch). The fix: add `var ErrPositionNotFound = errors.New(...)` at the repo layer
(`internal/repository/portfolio_repo.go`), following the *actual* existing precedent for this pattern
in the codebase — `ErrWatchlistNotFound` (`watchlist_repo.go:16-17`, `+errors.Is` mapping at
`portfolio_service.go:1147-1148`), not `GetPortfolio`/`ListPositions`/`GetPnL` (which don't do
NotFound-vs-Internal mapping at all). `GetPosition`'s repo function currently has **no**
`ErrNoRows`-special-case (verified: `scanPositionRow` wraps every scan failure identically) — the fix
adds one, following `GetAccountBalance`'s existing template (`portfolio_repo.go:317-331`).

**Audit trail.** `config.config_audit` (already exists — `services/xstockstrat-config/migrations/001_config_tables.up.sql:26-51`
+ `010_config_audit_insert_trigger.up.sql`, written synchronously in the same transaction as every
`SetConfig` write, already queryable via `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts`)
is the audit mechanism for this feature's V1 human-operator scope — **no new config→ledger
cross-service dependency is added**, correcting an earlier round's design that would have required
`xstockstrat-config`'s first-ever outbound gRPC edge for a purpose this existing table already serves.
AC-4's original "actor, reason, timestamp" requirement is met in full by wiring a **real reason-capture
`<Input>`** into the config-ui editor (`services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx:88`,
currently hardcoded to `'Updated via config-ui'` for every key — the only actual gap, since
`SetConfigRequest.reason` and `config_audit.reason` already exist end-to-end on the wire and in the DB),
required specifically when editing `platform.trading_state`.

Unrecognized/unparseable `trading_state` string values fail to `HALTED` (the maximally conservative
state) at the trading-side read (authoritative), plus write-time validation in `SetConfig` rejecting
any write to `platform.trading_state` outside the three known literals with `INVALID_ARGUMENT`.

**Automated-trigger scope (explicit, final).** V1 (this feature) is human-operator-only. `SetConfig`'s
unconditional ADMIN-scope gate (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:286-300`,
confirmed no internal-caller bypass exists anywhere — the identical wall that broke feature 030's
original automated-halt-fallback design) is **not** touched or worked around. Feature 102's
reconciliation ticker and feature 107's canary rollback are **named forward dependencies** — each must
design its own internal-caller authz path when it lands; this feature does not build one.

**C-04 (enums over strings).** Explicitly and narrowly **deferred, not permanently waived**: at this
feature's own implementation time there is exactly one producer (config-ui) and one consumer (trading's
gate) of the three-literal string — a proto enum is premature abstraction for a two-endpoint value
today. `product-spec.md`'s own Out-of-Scope already names 102 as a future second consumer, and 107
references the same gate; when either actually implements its own read/write path, the real fan-out
C-04 targets will exist, and a proto enum (mirroring `TradingMode`'s shape) should be added then.

## Rejected Alternatives

- **Widen `platform.maintenance_mode`'s `value_type` (bool→string) in place** — rejected: confirmed
  fail-open on a proto oneof type mismatch during a rolling deploy, the worst possible direction for a
  kill switch.
- **Fail-open on any `GetPosition` error during REDUCE_ONLY (matching `checkPortfolioRisk`'s
  philosophy)** — rejected: this gate is the enforcement point, not an advisory warning; allowing
  exposure-increasing orders through during an unreadable-position state defeats the gate's purpose.
  (Kept as a named Open Risk below, not a closed decision — the adversary's counter-argument, that
  fail-closed can defeat REDUCE_ONLY's own purpose during a correlated outage, is real and unresolved.)
- **Emit the audit ledger event from a `WatchConfig`-observing subscriber inside `xstockstrat-trading`**
  — rejected in the final round: verified `ConfigValue`/`ConfigSnapshot` carry no `actor`/`reason`
  field, so a value-diff subscriber structurally cannot reconstruct who/why a transition happened; and
  `config.Watcher` (`internal/config/config.go`) has no on-change hook today, only polling reads — this
  would have required inventing new `Watcher` plumbing to build a mechanism that couldn't deliver AC-4's
  requirement anyway. The `config-ui`/`config_audit`-only path is the adopted approach instead.
- **A generic config-key validation schema** (extending the existing float min/max metadata to an
  enum/allowed-values list) instead of a key-specific hardcoded check — rejected: more machinery than
  "write the minimum" calls for, for a single key.
- **Reduce-only carve-out shared with feature 030's `ReplaceOrder` gate as one unified mechanism** —
  rejected: the two features' halt concepts are orthogonal (030 is per-account/automated-circuit-breaker;
  100 is platform-or-mode-wide/operator-driven) and must not be conflated, per 030's own design.md.

## Open Risks

- [ ] **[Not fully resolved, flagged by the final adversary] Fail-closed REDUCE_ONLY on `GetPosition`
  errors creates a new hard dependency from trading's order-ingress path onto portfolio's availability
  that did not exist before, and can defeat REDUCE_ONLY's own purpose during a correlated portfolio
  outage** (no `ClosePosition` RPC exists — closes are ordinary `PlaceOrder` calls, so a portfolio
  outage during REDUCE_ONLY blocks ALL orders, including genuinely-reducing ones, exactly when an
  operator most needs risk-reduction to work). `/sdd-spec` should evaluate deriving "is this order
  net-exposure-reducing" from trading's own local order/fill history (`trading.orders`, already
  persisted) first, falling back to the cross-service `GetPosition` check only when local data is
  ambiguous — removing the hard dependency for the common case — before defaulting to the current
  fail-closed-on-any-error design. Size the `GetPosition` call's timeout short (2s, matching
  `checkPortfolioRisk`'s existing pattern) regardless of which approach is chosen.
- [ ] **Corrected stream-key convention**: earlier design language (and recon.md) used
  `trading_state:{account}` for a hypothetical ledger audit event — this is wrong, since this feature
  is explicitly platform-/mode-wide, not per-account (recon.md confirms no per-account halt concept
  exists in this feature's scope; that's 030's separate mechanism). If any future ledger event for this
  key is ever added (e.g. once 102/107 need one), use `trading_state:{trading_mode}` or reuse the
  ledger's existing `config:{namespace}` convention — never `{account}`.
- [ ] **Automated-trigger authz path is unbuilt** — 102's reconciliation ticker and 107's canary
  rollback both already reference this gate in their own product-specs but cannot write to it via
  `SetConfig`'s ADMIN-only gate. Each must design its own internal-caller authz path when it lands;
  this is a real, named gap this feature does not close.
- [ ] **Config migration number is 3-way contested** — `xstockstrat-config` currently tops out at
  `010_config_audit_insert_trigger`; features 023, 030, and 100 are all in-flight and need a new
  migration off that number. Whichever merges first claims the next number; the others renumber at
  merge time — the real `NNN` must be computed from the live tree (Constitution **C-07**), never
  guessed from any design doc, including this one or 030's (030's own design.md's "011/012" note
  predates 100 and is now a 2-way description of a 3-way problem).
- [ ] **`GetPosition`'s NotFound-status fix is a real behavior change for an existing UI consumer,
  not just this feature's new caller** — feature 096's position-detail page (`usePosition` hook)
  already calls this RPC. `/sdd-spec` should add a one-line verification that its error-handling path
  doesn't special-case the old (wrong) status code in a way that changes UX.
- [ ] **Product-spec's approval-gate checkbox must be flipped** from "1 service owner approval" to
  "service owner + config team," per root `CLAUDE.md` § Approval Flow's "New config key" rule — the
  parallel-key path was chosen, and product-spec's own conditional already anticipated this re-check.
- [ ] **A `fails.md` entry is worth adding** (not written here, since it should be confirmed once
  `/sdd-spec` locks the audit mechanism): "an audit/compliance requirement was nearly satisfied by
  reusing an existing value-stream (`WatchConfig`) without checking it actually carries the required
  write-metadata fields (actor/reason) — caught only by the final adversarial round of a 5-round
  debate."

## Constitution Rules Touched

- **C-01** (zero-assumption/evidence-cited) — honored by: every design decision cites real `path:line`
  evidence; this debate caught and corrected multiple false claims across its 5 rounds — a "zero
  callers" claim that was actually false, a "GetPosition already partially matches GetAccountBalance's
  pattern" claim that was also false, and an "audit mechanism can deliver actor/reason" claim caught
  only in the final round.
- **C-04** (prefer enums over strings) — explicitly, narrowly deferred (see Chosen Approach), not
  silently ignored — recorded with a stated re-evaluation trigger (102/107 landing).
- **C-05** (config key naming) — honored by: `platform.trading_state` follows the existing
  `platform.*` global-key precedent (`docs/patterns/config-governance.md`'s Global Config Keys table
  already includes `platform.maintenance_mode` in the same 2-segment shape).
- **C-07** (migration naming) — honored by: the 3-way contention is named as an explicit Open Risk
  rather than a guessed number being hardcoded anywhere.
- **C-08**/**P-06** (test pairing) — honored by: `/sdd-spec` must add coverage for both `GetPosition`
  error branches (previously untested — zero existing callers meant zero existing tests) and for the
  new gate's `HALTED`/`REDUCE_ONLY`/unrecognized-value branches.
- **C-10** (integration completeness) — honored by: the `GetPosition` fix's blast radius (096's UI
  consumer) was explicitly traced and confirmed safe, not assumed; the `isReplaceRiskReducing` seam is
  factored as its own named method specifically so 030's future bracket-leg exemption has a clean
  extension point, per 030's own design.md naming this feature as a forward dependency.
- **C-11** (no implementation without minimum SDD grounding) — honored by: full pipeline
  (`/sdd-story` → `/sdd-review product-spec` (2 rounds) → `/sdd-design` full mode, 5 rounds).
- **C-14** (name the consumer surface) — honored by: the pre-existing `/config-ui` display surface
  needs zero write-path code change (confirmed by recon); the new reason-capture field is the one
  concrete, named UI addition.
- **P-01/P-02/P-03/P-04** — honored by: all 5 rounds' proposer/adversary pairs were read-only and
  advisory, mediated only through the orchestrator's synthesized state; every self-flagged risk was
  either resolved or explicitly recorded as an Open Risk, never silently dropped; user steering
  ("address all 6 P0 items", "run round 3") is recorded in context.md.
- **F-11** (Floor rejection halts) — honored by: no Floor breach was ever flagged across any of the 5
  rounds; the final verdict is "approve with noted open risks," the expected outcome at the hard cap
  for a feature this complex, not a block.
