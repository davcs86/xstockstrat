# Design: stop-loss-bracket-orders

**Created**: 2026-08-06
**Rounds**: 5 (full; termination: approved at round-5 hard cap, with noted open risks)
**Approved by**: user @ 2026-08-06
**Grounded in**: recon.md

---

## Chosen Approach

`xstockstrat-trading` submits, verifies, resizes, and cancels stop-loss/take-profit bracket orders as
an explicit, persisted **state machine** — `NONE → SUBMITTING → PENDING_VERIFY → ACTIVE → CANCELING →
CANCELED / back-to-SUBMITTING (resize)`, with `FAILED → flatten → halt` on any failure or timeout —
rather than ad hoc broker calls, satisfying OQ-2 and the P0 safety review's "treat cancel-and-replace
as an explicit state machine" requirement (`product-spec.md`, `context.md` 2026-08-04).

**Trigger and price source.** The hook fires from both fill-confirmed paths — `PlaceOrder`'s own
immediate-fill path (market orders) and `pollFills`'s `ORDER_STATUS_FILLED`/`ORDER_STATUS_PARTIALLY_FILLED`
branches (`services/xstockstrat-trading/internal/service/trading.go:363-370,731-748`) — gated on a
**new, dedicated** `Order.bracket_stop_price` field (never `order.StopPrice`/`req.StopPrice`, which
carry STOP/STOP_LIMIT entries' own real broker-trigger price and would collide — the exact
"convenient-but-wrong field" trap logged in `fails.md` 2026-08-05). Feature 023's `ComputePositionSize`
must persist this value for **every** auto-sized entry type, including STOP-family entries where its
current design discards it.

**Broker split.** Alpaca: bracket parameters attach atomically at entry `SubmitOrder` time
(`internal/broker/alpaca.go:95`) — Alpaca's real API has no other bracket-attach mechanism, and this is
strictly safer than post-fill submission (no fill→stop gap); brackets natively resize with cumulative
fills, so trading only reads legs back via the existing `GetOrder` method. IBKR: two follow-up orders
sharing an `OCAGroup` string, submitted after fill confirmation and explicitly resized on each
subsequent partial-fill delta (`internal/broker/ibkr.go:116`, confirmed to have no bracket/OCA support
today).

**Protection window.** A single, re-armed `trading.risk.max_unprotected_seconds` budget is checked at
**every** transition that leaves `ACTIVE` (or hasn't reached it) — the initial `NONE→SUBMITTING` arm
**and** every `ACTIVE→CANCELING→SUBMITTING` resize transition, not just the first. A watchdog scans
`order_brackets` for `protection_deadline < now()` each `StartFillPoller` tick, bounded by its own
`context.WithTimeout(ctx, 2*time.Second)` scan (reusing `checkPortfolioRisk`'s pattern,
`trading.go:1297`); each candidate spawns its own `go s.flattenAndHalt(...)` goroutine guarded by a
`flattenInFlight` dedup map, so one account's slow flatten (bounded ~21.5s worst case with default
retry config) never blocks fill detection or the protection check for every other account — the
scenario most likely during exactly the broker-wide outage this feature must survive.

**Flatten reuses `PlaceOrder`'s own safety machinery**, not a bare broker call. `PlaceOrder` is split
at its existing approval-decision seam (`trading.go:276-277`, unchanged) into a new shared
`submitOrder(ctx, req, accountEntry, mode, orderID, requiresApproval)` helper that preserves the
approval-required early-return path verbatim (construct+persist+`order.created` unconditional, then
branch on `requiresApproval`: true → `order.approval_requested`+alert, no broker call; false →
`order.submitted`+broker submission). Flatten calls this helper directly with `requiresApproval=false`
hardcoded (a flatten must never wait on human approval), and mints its `ClientOrderID` **once per
protection-gap-expiry episode**, reused across the bounded retry loop — preserving the platform's
broker-side dedup contract instead of minting a fresh ID per retry.

**Halt.** A new, **persisted** per-account halt state — `trading.broker_accounts` gains
`halted`/`halted_at`/`halt_reason` columns via migration `005_broker_accounts_halted`, following the
exact `credential_status` precedent (`migrations/004_broker_accounts_credential_status.up.sql:5-7`,
hydrated into `s.credStatus` at `LoadBrokerPool` boot, `trading.go:127,155-157`) — not a bare
process-local map. A routine redeploy (every merge to `main-dev`/`main`) must not silently un-halt an
account whose underlying failure condition may still be present. The dual-write ordering (adopted from
the round-5 adversary's correction, not the proposer's original suggestion): set the in-memory map
under its mutex **first**, release immediately, **then** issue the DB write with a bounded timeout
(mirroring `validateAndRecordCredential`'s pattern, `trading.go:1072-1090`) — never hold the mutex
across the DB round-trip. On DB-write failure, do **not** roll back the in-memory halt: fail-safe means
the current process stays halted even if persistence lags; the persist retries in the background. A
CRITICAL alert (`ALERT_SEVERITY_CRITICAL`, reusing the `EmitAlert` shape at `trading.go:1441,1455`)
fires in the same call path as the halt transition, satisfying the P0 review's "page the operator."

`PlaceOrder` gates on `isAccountHalted` right after the existing maintenance-mode check.
`ReplaceOrder` gets the identical gate and **blocks outright** (no reduce-only carve-out — no such
precedent exists anywhere in this service, and feature 100, which should own that nuance, is still
`spec-ready`). `CancelOrder` is **explicitly, deliberately not gated** — canceling exposure is always
safe and is the operator's sole remaining manual de-risk tool once `PlaceOrder`/`ReplaceOrder` are
frozen.

**Coexistence with feature 100 (new, added at final approval — C-10).** 030's per-account,
DB-persisted `broker_accounts.halted` flag and feature 100's planned platform-wide
`platform.maintenance_mode`/richer-enum gate are **orthogonal, both required, and must not be
conflated**: 030's flag is an automated circuit-breaker triggered by a single account's own bracket
failure (narrow, automatic, no operator judgment involved); 100's gate is a manual, operator-driven,
platform-wide (or eventually per-mode) kill switch. `PlaceOrder` will check **both** gates
independently once 100 lands (100's gate already exists at `trading.go:244-246`; 030's is new,
positioned immediately after it). This is a **named forward dependency for feature 100's own
`/sdd-design`**: 100 must not reinvent or attempt to unify 030's per-account schema, and must record in
its own `context.md` that a per-account auto-halt already exists as prior art.

## Rejected Alternatives

- **Gate the bracket hook on `order.StopPrice`/`req.StopPrice`** — rejected: collides with STOP/STOP_LIMIT
  entries' own real broker-trigger price, and the poller-based hook site can't access
  `ComputePositionSize`'s in-process return value at all. A dedicated `bracket_stop_price` field works
  uniformly at both hook sites.
- **A new synchronous `SetPositionBracket` RPC from trading to portfolio for the cancel-and-replace
  safety check** — rejected: unnecessary. Trading already persists the leg order IDs on its own
  `Order`/`order_brackets` records; the safety-critical read never needs to leave the service. Portfolio's
  display-only `stop_order_id`/`take_profit_order_id` populate via the normal async ledger-consumption
  pattern instead, preserving portfolio's "all state changes sourced from ledger events" invariant.
- **Write the automated halt via a raw `SetConfig` call to `platform.maintenance_mode`** — rejected:
  verified non-functional. `SetConfig` requires end-user ADMIN scope on the propagated `x-access-scope`
  header; `StartFillPoller`'s background ticker carries zero propagated metadata, so this would return
  `PERMISSION_DENIED` in exactly the unattended scenario the fallback exists for. The persisted,
  trading-owned per-account halt (above) sidesteps this authz problem entirely.
- **Hold the halt mutex across the DB write** (the round-5 proposer's original suggestion) — rejected
  by the final adversary pass: would block every concurrent reader (including `PlaceOrder` itself) for
  an unbounded DB round-trip. Set-map-then-release-then-bounded-DB-write is the correct ordering, and
  rolling back the in-memory halt on a DB-write failure would swing safety the wrong direction; not
  rolling back keeps the fail-safe direction.
- **Reduce-only carve-out for `ReplaceOrder` on a halted account** — rejected: no reduce-only precedent
  exists anywhere in this service; inventing a partial, ad hoc version here risks a subtly-wrong carve-out
  in the highest-stakes code path this feature touches. Blocking outright is simpler and safer; `CancelOrder`
  remains the de-risk escape hatch.
- **Two separate protection-window config keys** (one for initial arm, one for resize gaps) — rejected:
  the underlying risk (an uncovered position) is identical in both cases; one re-armed key covers both
  without extra config-governance overhead.
- **Reuse feature 100's mechanism instead of a new per-account column** (considered at final approval) —
  rejected for now: would create a hard 030→100 sequencing dependency (100 is only `spec-ready`, not yet
  designed), repeating the exact cross-feature blocking this feature already suffered from its 023
  dependency. Proceeding with 030's own schema and recording an explicit coexistence note (above) is the
  defensible trade for a P0-priority feature, made explicitly rather than silently.
- **Ship the production `bracket_orders_enabled` flag defaulting `true`** (the product-spec's literal
  default) — rejected: the config seed migration deviates from this, seeding `false` in production
  (`true` in dev/staging) until feature 103 (broker-failure-simulator) lands or a documented manual
  paper-trading verification of duplicate-fill/stale-cancellation/OCA-race scenarios is recorded per
  `docs/runbooks/config-rollout.md` — a named, justified override, not a silent contradiction of the spec.

## Open Risks

- [ ] **Feature 103 dependency for full test coverage.** The state machine's happy path, config
  toggles, window-expiry→flatten→halt (success and failure), resize re-arm, and CRITICAL alert emission
  are unit-testable now via a hand-rolled mock of `broker.Broker` (`internal/broker/broker.go:57-76`,
  confirmed clean/mockable). True broker nondeterminism — duplicate fill events, stale/out-of-order
  cancellation responses, real OCA races — cannot be deterministically reproduced without feature 103
  and is an accepted, named test gap. Does not block `/sdd-spec`, but the production flag flip (above)
  is gated on it or a documented manual verification.
- [ ] **023 must reach real `implementation-ready` status before `/sdd-spec` for 030 can cite real line
  numbers.** This design is grounded in 023's `design.md` planned statement order, not currently-existing
  code (recon's hard sequencing blocker).
- [ ] **Config migration number 011/012 coordination with feature 023** — whichever of 023/030 merges
  first claims `011`; the other takes `012`. Must be verified at merge time, not assumed.
- [ ] **`trading.proto` bracket/OCA field shape is not yet resolved** — the product spec's own Proto
  Contract Changes section never named `trading.proto`, only `portfolio.proto`. `/sdd-spec` must design
  the exact new fields needed on `PlaceOrderRequest`/`Order` for bracket/OCA submission.
- [ ] **IBKR's exact `ocaGroup`/`ocaType`/`parentId` JSON key names are unverified against IBKR's real
  Client Portal Web API** — recon confirmed they don't exist anywhere in this repo; `/sdd-spec` must
  verify against IBKR's actual API reference, not fabricate the shape.
- [ ] **`trading.risk.max_unprotected_seconds`'s concrete default value** is a product/ops decision (the
  P0 review's example was 5 seconds) — not pinned by this design; `/sdd-spec` or the user should set it.
- [ ] **Multi-replica exposure** (both the halt map and `flattenInFlight`) is a pre-existing property of
  this design's process-local caching, not unique to any one fix. `xstockstrat-trading` runs as a single
  instance today (verified against `.do/app.yaml`/`.do/app.dev.yaml`), so this is not a live risk, but
  should be re-verified if the service is ever scaled beyond one replica.

## Constitution Rules Touched

- **C-01** (zero-assumption/evidence-cited) — honored by: every design decision cites real `path:line`
  evidence; multiple false claims were caught and corrected across 5 rounds (the `SetConfig` authz
  claim, the `Position.stop_price` populating-mechanism claim, the "hold the mutex across the DB write"
  claim) before they could ship.
- **C-05** (config key naming) — honored by: `trading.risk.bracket_orders_enabled`,
  `trading.risk.take_profit_rr_multiple`, `trading.risk.max_unprotected_seconds` all follow
  `<service>.<category>.<key>`.
- **C-07** (migration naming) — honored by: `005_broker_accounts_halted` (trading), `009_bracket_order_ids`
  (portfolio) both follow `NNN_description` sequenced off each service's own last migration.
- **C-08**/**P-06** (test pairing, red-before-green) — honored by: an explicit, named test-scope decision
  (hand-rolled `broker.Broker` mock for what's testable now; feature 103 named for what isn't) rather
  than a silent gap.
- **C-10** (integration completeness) — honored by: the feature-100 coexistence note (added at final
  approval) explicitly preventing two silently-diverging "is this account halted" concepts; the
  portfolio parity question (are `stop_order_id`/`take_profit_order_id` consistent across
  `GetPosition`/`ListPositions`/`ListPositionsByAccount`) was investigated and confirmed already
  structurally solved via shared `positionColumns`/`scanPositionRow`, not left assumed.
- **C-11** (no implementation without minimum SDD grounding) — honored by: full pipeline
  (`/sdd-story` → `/sdd-review product-spec`, 2 rounds to PASS → `/sdd-design` full mode, 5 rounds).
- **C-14** (name the consumer surface) — honored by: the pre-existing `/trader` display surface
  (position-detail sidebar extension, per feature 096) is unchanged; the CRITICAL alert flows through
  the existing, unmodified `AlertStream.tsx` generic renderer.
- **P-01** (single-orchestrator authority) — honored by: all proposer/adversary rounds were read-only
  and advisory; every write (recon.md, this file, feature.md, context.md) is by the orchestrating skill
  only.
- **P-02** (no lateral subagent coordination) — honored by: each adversary round received only the
  orchestrator's synthesized state, never a prior adversary's raw output.
- **P-03** (no silent deviation) — honored by: every self-flagged risk across 5 rounds was either
  resolved with a concrete decision or explicitly recorded as an Open Risk, never silently dropped.
- **P-04** (phase-gate approval, recorded) — honored by: user-directed steering at rounds 2 and 3
  ("address all 6 P0 items now", "run round 3"), and final approval recorded here.
- **F-06** (DB pool budget) — honored by: the new `trading.order_brackets`/`broker_accounts.halted`
  columns live in trading's existing PgBouncer-pooled connection; confirmed no new pool or `DB_POOL_MAX`
  change.
- **F-11** (Floor rejection halts) — honored by: no Floor breach was ever flagged across all 5 rounds.
