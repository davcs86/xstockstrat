# Context: broker-state-reconciliation

**Feature**: `docs/roadmap/features/102-broker-state-reconciliation/feature.md`
**Product Spec**: `docs/roadmap/features/102-broker-state-reconciliation/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/102-broker-state-reconciliation/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P0 item 5 ("broker-versus-platform reconciliation").
- Depends on 101 (exactly-once-order-intent) for the `UNKNOWN`-state contract it reconciles against.
  Feeds 100 (account-trading-halt-and-kill-switch) as an automatic halt trigger on unsafe mismatches,
  and 108 (trading-safety-dashboard-slos) as a status/age metric source.

## Session 2026-08-04T01:00:00Z — feasibility re-check (demoted)

- The user pushed back on the initial mechanical translation of the review into features and asked
  for an actual feasibility/realism analysis against this repo. That analysis found: (1)
  `xstockstrat-analysis`'s live loop only calls `EmitAlert`, never `PlaceOrder`
  (`services/xstockstrat-analysis/app/engine/` — grep confirmed zero non-test hits); feature
  `048-live-strategy-alert-engine`'s own spec is explicit that it is alert-only, human-acts-on-it. The
  MCP agent (`services/xstockstrat-agent/app/tools.py`) has no order-placement tool. The **only**
  caller of `TradingService.PlaceOrder` in the repo is the human-driven trader UI
  (`services/xstockstrat-ui/src/lib/traderBff.ts:28`). (2) There is no automated/unattended
  order-placement path today for broker state to silently drift out from under.
- Demoted to `demoted/canceled`. Today, a human reviewing the trader UI against the broker's own
  dashboard before/after every manual order is the de facto reconciliation — thin, but real, and
  proportionate to a single-operator project. Revisit this feature if/when an automated
  strategy-to-order execution path is actually approved as a feature (which would reintroduce the
  unattended-drift risk this feature addresses), or if manual review is found insufficient in
  practice.

## Session 2026-08-04T02:00:00Z — user review (revived, rescoped)

- The user pushed back on demoting this specific feature: "102 sounded good even for a solo
  maintainer." Re-examined with that framing: the full continuous-engine-plus-dashboard version
  really was disproportionate, but a **much cheaper version is genuinely low-cost even solo** — a
  periodic ticker inside `xstockstrat-trading` itself (the only service holding broker credentials),
  reusing its existing `alpaca.go`/`ibkr.go` clients, writing to the existing ledger `AppendEvent` RPC
  instead of a new table, and alerting via the existing `xstockstrat-notify` `EmitAlert`. No new
  service, no new dashboard, no new database table.
- Revived to `draft` and rewrote `product-spec.md` around that lighter design. Kept the dependency on
  `101` (rescoped) — this feature is exactly where `101`'s deferred "who resolves an `UNKNOWN` order
  intent" question gets answered.
- General lesson for next time: "protects a capability that doesn't exist yet" was the right objection
  to most of the demoted items (102's original scope included), but it over-applied here — the *cheap*
  version of a control can still be worth building now even when the *expensive* version should wait.
  Re-scope before demoting, not just demote.

## Session 2026-08-05T00:00:00Z — sdd-review product-spec (2 rounds)

- Round 1 FAIL: C-5 trading-domain blocker — FR-2's mismatch taxonomy never distinguished a routine
  `ORDER_STATUS_PARTIALLY_FILLED` order from a genuine quantity-discrepancy mismatch, risking a false
  `REDUCE_ONLY` halt on every ordinary partial fill (directly counter to the feature's own "self-heal
  benign cases" goal). Fixed: FR-2 now states a partial fill is not itself a mismatch — only a
  post-propagation-delay quantity disagreement counts.
- Round 2: **PASS WITH WARNINGS** (4 advisory: state both `BrokerType`s explicitly in scope, define
  the "unprotected/impossible" bucket, state how `ORDER_STATUS_FILLED` interacts with the open-orders
  comparison, add a `## Dependencies` section). Fixed the `## Dependencies` section (100, 101) and
  folded the remaining three into Open Questions in the same pass. Status: `draft` → `spec-ready`.

## Session 2026-08-06T00:00:00Z — sdd-design (full mode, in progress)

- Phase 0 Recon: wrote `recon.md` (services: trading, portfolio, notify, ui). Confirmed both hard
  dependencies (100, 101) are `design-approved` but have zero code yet — this design plans against
  their `design.md` files' planned contracts, the same situation 030 was in against 023. Found
  product-spec's claimed ledger stream-key `reconciliation:{account}` is ungrounded — the real existing
  precedent for this exact shape is bare `account:{account_id}` (`trading.go:898,914`). Found no
  broker-side bulk order-list method exists on either Go client, but flagged this needed external
  verification (the internal interface's absence doesn't prove the broker's real REST API lacks one).
  Found the portfolio read dependency (`s.portfolio` client) already exists, no new plumbing needed for
  FR-1's position-side comparison. Found a `GetPosition` account-scoping gap in `xstockstrat-portfolio`.
  `Order` proto field planning must account for 101's claimed-but-unimplemented field 21 (so 102's own
  field, if needed, is 22).
- Round 1: proposer's approach — new `StartReconciliationPoller`, FR-4 halt via a brand-new,
  parallel trading-local persisted-state mechanism (own migration, own columns), FR-6 via a fresh
  `GetOrder` call assuming it accepts a client-order-id interchangeably (unverified). Adversary found no
  Floor breach but severe objections: (1) the proposed halt mechanism doesn't actually use 100's kill
  switch at all — it dodges the exact internal-caller authz wall 100's own design.md explicitly named
  102 as needing to solve; (2) "no bulk broker order-list exists" was verified only against the internal
  Go interface, never against Alpaca's/IBKR's real REST APIs — this false/unverified premise is what
  makes the design's own admitted "Strongest Risk" (a still-open manually-placed order is undetectable,
  directly falsifying AC-1) appear unavoidable when it likely isn't; (3) 030's per-account halt and
  102's proposed halt are the same automated-circuit-breaker axis, not orthogonal — 030's own design.md
  explicitly says future features "must not reinvent... 030's per-account schema," contradicting the
  proposal's "030 is not a declared dependency" framing; (4) migration number/UI-consistency/poller-load
  gaps.
- **User directive**: "add a SYSTEM scope for this kind of automated changes" — resolves objection (1)
  with a concrete mechanism: extend `xstockstrat-config`'s existing `ADMIN_SCOPE` bitmask
  (`services/xstockstrat-config/src/grpc/authz.ts:22`) with a new bit for internal/automated callers.
- Orchestrator verified objection (2) externally before round 2: Alpaca's real REST API documents a
  bulk `GET /v2/orders` endpoint (confirmed via public API docs, not present in this repo's `alpaca.go`
  today); IBKR's own `GetOrder` implementation (`ibkr.go:254-286`) already calls a bulk endpoint
  (`/iserver/account/orders`) and just filters client-side to one order — dropping that filter yields a
  free bulk list. This resolves the "Strongest Risk" as a real, cheap fix, not a scope cut.
- Round 2: folded in both resolutions — `Broker.ListOrders()` added to the shared interface (Alpaca via
  the newly-confirmed bulk endpoint, IBKR via reusing `GetOrder`'s existing endpoint minus its filter),
  making AC-1 literally true (detected within one tick, not only once filled); a new `SYSTEM_SCOPE`
  bit in `authz.ts`, scoped narrowly to `platform.trading_state` only, trust-argued via `.do/app.yaml`'s
  confirmed internal-only port exposure for `xstockstrat-config`. Also split FR-4's halt: ordinary
  per-account findings → reuse 030's planned `broker_accounts.halted` columns (accepting round 1's
  axis-overlap finding), only a rare "systemic" finding → escalates via `SYSTEM_SCOPE` to 100's
  platform-wide gate. Adversary found no Floor breach but two Commandment-level problems: (a)
  `SYSTEM_SCOPE` reusing `x-access-scope` — the header that today only ever carries a *forwarded,
  entry-point-authenticated human's* role — for a service's own *self-originated* assertion is a
  genuinely new trust model, checked only by config key not caller identity, for a live-capital kill
  switch specifically; (b) the halt-split silently redefines product-spec's own AC-3/FR-4 wording
  ("halts via the rescoped 100") without recorded sign-off, a Commandment-override requiring explicit
  user consent, not a design-round reinterpretation. Also found `halt_source` stacks a second
  undeferred C-04 string-enum choice atop 100's already-deferred one (this one has no legacy-string
  excuse — greenfield, should be a real proto enum), and a `BrokerAccount` field-9 claim needs
  pre-assignment before 030 might independently claim it.
- **User directive**: "Keep SYSTEM_SCOPE, fix it properly" — resolves both Commandment-level objections
  at once: (a) SYSTEM_SCOPE stays, but round 3 must implement it as a dedicated internal-caller channel
  distinct from `x-access-scope`'s user-role bitmap, not an overload of it; (b) explicit sign-off
  granted for the AC-3/FR-4 wording amendment. `product-spec.md` amended same-session: FR-4/AC-3 now
  state the halt-split explicitly (ordinary → 030, systemic → 100 via a new internal-caller mechanism,
  not a raw `SetConfig` call); FR-5's stream key corrected to `account:{account_id}`; Database Changes
  flipped from "no schema changes" to "DB migration" with the DBA-review approval gate checked; AC-5
  amended to require one coherent derived restriction display, not multiple independent badges;
  `030` added as a real `## Dependencies` entry (not just an informal axis note).
- Round 3: replaced `x-access-scope` reuse with a new, structurally separate `x-internal-caller`
  metadata field + a hardcoded `{callerID, namespace, key}` allow-list in `authz.ts`, additive alongside
  `hasAdminAccessScope`; registered `"system:reconciliation-poller"` as a documented author-sentinel
  convention (C-10(c), the exact rule `fails.md` 2026-07-01 produced); made `HaltSource` a real proto
  enum instead of an app-validated string (greenfield field, no legacy-string excuse unlike 100's
  deferred `trading_state`); claimed `BrokerAccount` fields 9-12 explicitly, flagged for a
  `merge-order.md` pre-assignment against 030; added an explicit `accountId` query param to IBKR's
  planned `ListOrders` call (flagged as unverified, a distinct risk from the client-order-id field-name
  risk); spelled out FR-6's CAS resolution branches (Completed/Rejected/no-write-stays-Unknown).
  Adversary found no Floor breach but two final, concrete, mechanical gaps: (a) the internal-caller
  check authorized ANY value on the allow-listed key, not just an escalating one — a bug or compromised
  caller could silently clear a human-set `HALTED` back to `ACTIVE`, the single most dangerous
  direction for a live-capital kill switch; (b) the new `caller_identity` audit column was added to the
  schema and both trigger functions but never actually wired into `setConfig`'s own `INSERT`/`ON
  CONFLICT DO UPDATE SET` write path — verified directly against `config_tables.up.sql`'s real trigger
  bodies — so the column would stay `NULL` forever despite the schema/trigger work being correct.
  Adversary explicitly recommended folding both fixes in directly (no round 4 needed), the same
  resolution path 101's round-7 adversary took — orchestrator did so: added `allowedTargetValues`
  (direction-restricted, e.g. `REDUCE_ONLY`/`HALTED` only, never `ACTIVE`) to the allow-list check, and
  named the exact `configServiceImpl.ts` bound-parameter addition needed for both the `INSERT` column
  list and the `ON CONFLICT` `SET` clause.
- Chosen approach: new `StartReconciliationPoller` mirroring the existing poller shape; `Broker.
  ListOrders()` added to the shared interface (externally verified both brokers support bulk listing,
  making AC-1 literally true); mismatch classification with an explicit propagation-delay grace window
  and no-event self-heal; halt-split (ordinary per-account → 030's columns + a new `HaltSource`
  discriminator, rare systemic → 100's platform gate via a new `x-internal-caller` authz channel,
  direction-restricted to escalation only); FR-6 checks 101's `late_response_conflict` event first,
  falls back to a `ListOrders` scan, writes a new anticipated-by-101 CAS; ledger stream key
  `account:{account_id}` (corrected from an ungrounded guess); UI reuses existing `QueryEvents`, no new
  proto field needed for the surface itself. Rejected: a brand-new parallel halt mechanism dodging both
  030 and 100; reusing `x-access-scope` for service self-assertion; escalating every ordinary finding to
  100's platform gate; folding `caller_identity` into free-text `author` instead of a structural column;
  an unbounded-authority (non-direction-restricted) internal-caller check.
- Constitution rules touched: C-01, C-04, C-05, C-07, C-08, C-10(a), C-10(b), C-10(c), C-11, C-14, P-01,
  P-02, P-03, P-04, F-11 (all honored — see design.md § Constitution Rules Touched). No Floor breach
  across any of the 3 rounds; the adversary explicitly confirmed no Floor item in the Constitution
  addresses authz self-assertion directly — a documented gap in Constitution coverage, not proof of
  safety, carried forward as context for a possible future Constitution update.
- Status: `spec-ready` → `design-approved`.

## Session 2026-08-06T01:00:00Z — sdd-spec

- Generated `implementation-spec.md` with 25 steps covering `packages/proto`, `xstockstrat-trading`,
  `xstockstrat-config`, and `xstockstrat-ui`. Status → `implementation-ready`.
- `recon.md` covered `xstockstrat-trading`/`xstockstrat-portfolio`/`xstockstrat-ui` in depth but not
  `xstockstrat-config` at all (design.md's internal-caller mechanism needs it) — did full inline
  discovery on `xstockstrat-config` (`authz.ts`, `configServiceImpl.ts`, `001_config_tables.up.sql`,
  `002_config_environment.up.sql`, `010_config_audit_insert_trigger.up.sql`) myself rather than
  spawning a subagent (no `Task` tool available in this session — did the discovery directly per the
  skill's inline-discovery fallback).
- Key codebase findings beyond `design.md`/`recon.md`:
  - **IBKR never sends a client/customer order tag on `SubmitOrder`** (`internal/broker/ibkr.go:116-156`
    builds its request body with no `ClientOrderID`/`cOID` key at all, confirmed by direct grep) —
    deeper than `design.md`'s Open Risk #2 (which only questioned the *response* field name). FR-6's
    broker-side `ListOrders`-scan fallback is therefore **Alpaca-only**; IBKR's `UNKNOWN` intents can
    only resolve via the `order_intent.late_response_conflict` ledger-event path. Extending IBKR's
    `SubmitOrder` to forward a nonce is named as an explicit out-of-scope follow-up, not silently
    absorbed into this feature.
  - **`101`'s own `implementation-spec.md` never actually emits `order_intent.late_response_conflict`**
    anywhere in its Instructions (only named in a forward-reference dependency note, `:55`) — grepped
    the whole file to confirm. Step 21 states this gap explicitly rather than assuming the event will
    exist; if `101` lands without fixing this, Step 21's Instruction 2a's "first check" branch can
    never match and only the Alpaca-only fallback (2b) or the no-write branch (2c) are live.
  - **`LedgerService.QueryEvents.event_type` is a single exact-match filter**
    (`packages/proto/ledger/v1/ledger.proto:56`), not a prefix filter — `design.md`'s UI section
    implies filtering by "the `reconciliation.`/`order_intent.` event-type prefixes" server-side,
    which the RPC cannot do. Step 24 fetches by `stream_key` alone and filters client-side, mirroring
    `usePositionLineage.ts`'s existing shape.
  - Confirmed via `merge-order.md`/ledger cross-check: `100` claims `xstockstrat-config` migration
    `011_platform_trading_state`, `023` was renumbered to `012_trading_risk_sizing` in the same
    directory (both `implementation-ready`, unimplemented) — this feature's own config migration
    (`caller_identity`) claims `013_config_caller_identity`, contested and explicitly flagged for a
    live `ls` re-check at execute time (all three ahead of `102` in the `100 → 101 → 023 → 030 → 102`
    build order).
  - `xstockstrat-trading` migrations: confirmed `004_broker_accounts_credential_status` is the real
    last file on disk today; this feature's migration claims `007_broker_accounts_halt_source`,
    following `030`'s planned `005` and `101`'s planned `006` (both unimplemented, per
    `merge-order.md:44`).
  - `packages/proto/trading/v1/trading.proto`'s `BrokerAccount` message real highest field is
    `credential_checked_at = 8` — this feature claims fields 9-12 (`halted`/`halted_at`/`halt_reason`/
    `halt_source`), resolving `merge-order.md:47`'s contested row (`030` never claims a proto surface
    for its own halt columns — DB-only per its own `design.md`).
  - `xstockstrat-portfolio`'s `GetPosition` account-scoping gap (found by `recon.md`) is routed around
    via `ListPositions(account_id=...)` throughout the reconciliation poller, per `design.md`'s
    decision — no portfolio-service code changes in this spec.
- Reviewers snapshot finalized: added DBA, Proto Reviewer, and Security explicitly (present in the
  registry's step-category matrix but not itemized in the original product-spec table); kept
  Platform Lead (new `trading → config` outbound edge) and `xstockstrat-portfolio` owner (an active
  new `ListPositions` caller, even though no portfolio-service code changes in this spec).

## Session 2026-08-06T00:00:00Z — cross-feature coordination pass (post-/sdd-spec)

- Found and fixed a real migration-number collision the automated overlap scan missed: this feature's
  Step 6 (`xstockstrat-config`'s `caller_identity` audit column) independently claimed `013`, the same
  number `030`'s own `implementation-spec.md` (Step 16) had already claimed for
  `013_trading_risk_bracket` — 030's claim was never cross-referenced when this step was specced.
  Renumbered this feature's migration to `014_config_caller_identity`; `merge-order.md` updated with
  the collision row.
- User confirmed `trading.reconciliation.systemic_threshold_pct` default stays **0.5** (50% of
  registered accounts erroring/unprotected in one tick) — the threshold for escalating from 030's
  per-account halt mechanism to 100's platform-wide gate via this feature's internal-caller authz path.
