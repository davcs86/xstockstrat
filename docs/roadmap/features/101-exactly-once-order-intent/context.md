# Context: exactly-once-order-intent

**Feature**: `docs/roadmap/features/101-exactly-once-order-intent/feature.md`
**Product Spec**: `docs/roadmap/features/101-exactly-once-order-intent/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/101-exactly-once-order-intent/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review. P0 item 4 ("idempotent order-command model").
- No upstream dependency — per the review's suggested execution order this can start alongside 100.
  It is itself a hard dependency for 102 (broker-state-reconciliation resolves `UNKNOWN` intents),
  105 (trading-crash-consistency tests this model's restart behavior), and 107 (canary promotion
  evidence requires "zero duplicate intents").

## Session 2026-08-04T01:00:00Z — feasibility re-check (rescoped, not demoted)

- Feasibility re-check confirmed the only real caller of `TradingService.PlaceOrder` is the trader UI
  (`services/xstockstrat-ui/src/lib/traderBff.ts:28`) — no scheduler, agent tool, or internal RPC
  places orders today. Kept this feature (unlike its downstream dependents 102/104/105/107, all
  demoted) because a redeploy mid-request is a real risk on this single-instance topology even for a
  human-initiated order — but rewrote `product-spec.md` to scope FR-1 to place/replace/cancel only
  (the commands with a real caller), dropped close/emergency-flatten as first-class command types, and
  replaced automated `UNKNOWN`-reconciliation (which depended on the now-demoted 102) with a manual
  "block further auto-retry, operator checks the broker dashboard" gate.

## Session 2026-08-05T00:00:00Z — sdd-review product-spec (3 rounds)

- Round 1 FAIL: missing DB migration numbering/run-order detail (C-07), no explicit statement of how
  the new `UNKNOWN` intent state interacts with `ORDER_STATUS_PARTIALLY_FILLED`/`FILLED` (C-5), two
  unresolved Open Questions. Fixed: added migration `005_order_intents` (next after `004`), added an
  explicit "Interaction with the existing order-status lifecycle" section stating fill handling is
  unaffected, resolved the client-side-identifier Open Question by grep (no existing generator —
  this is the platform's first).
- Round 2 FAIL: the remaining two Open Questions were reframed with "Decide at /sdd-design" language
  but left as literal unchecked items; one (which `BrokerType` values are in scope) is a genuine C-2
  trading-domain gate, not an implementation detail. Fixed: resolved and checked both (both `ALPACA`
  and `IBKR` in scope; paper/live behavior identical since `is_paper` is account-level) — only the
  client-order-id derivation *algorithm* itself stays deferred to `/sdd-design`, in an un-checkboxed
  "implementation detail" list per the `055-orders-management-ui` precedent.
- Round 3: **PASS WITH WARNINGS** (2 advisory warnings: qualitative ACs, a minor phasing-precedent
  note on the `055` comparison). Status: `draft` → `spec-ready`.
- Warnings carried forward (advisory, not blocking): xstockstrat-ui/orders-view file-level overlap
  with feature 096 to re-check at impl-spec (from the overlap scan, non-blocking); AC-1..AC-4 are
  qualitative correctness statements rather than quantitative thresholds.

## Session 2026-08-06T00:00:00Z — sdd-design (full mode, in progress)

- Phase 0 Recon: wrote `recon.md` (services: trading, ui). Confirmed zero idempotency layer exists
  today (a retry mints a fresh UUID and resubmits); confirmed timeout and genuine rejection are
  currently conflated (`ORDER_STATUS_REJECTED` either way); confirmed IBKR's broker client sends no
  client-order-id at all (platform-side dedup is the *only* dedup mechanism for IBKR, not a backstop);
  confirmed no insert-or-return-existing persistence pattern and no `ErrNotFound`-style sentinel exist
  anywhere in this service. Found a real migration-number collision with feature 030 (both want `005`
  in the shared `xstockstrat-trading/migrations/` dir) and confirmed `merge-order.md` had no
  pre-assignment row for it.
- Fixed the migration collision directly (not deferred to the design debate): added a `merge-order.md`
  pre-assignment row following the existing 058/059/062 precedent — 030 → `005_broker_accounts_halted`,
  101 → `006_order_intents` (committed separately from the design debate).
- Round 1: proposer's approach — new `order_intents` table, unique-constraint + in-process keyed-mutex
  concurrency, orthogonal `IntentState` field (not `ORDER_STATUS_UNKNOWN`) on `Order`, migration `006`.
  Adversary found no Floor breach, but two severe objections: (1) **C-14** — FR-1/FR-2's core dedup
  guarantee for `PlaceOrder` has no defined mechanism without the trader UI generating and reusing a
  client-side nonce across retries, which was outside the original product-spec's Consumer Surface(s);
  (2) **P-03** — the in-process mutex's sole justification ("`instance_count: 1` → no cross-instance
  coordination needed") is unverified against DO App Platform's actual rolling-deploy mechanics, and is
  likely false exactly during a redeploy — the failure window this feature exists to protect. Also
  found the UI fix names only 1 of 5 real call sites needing updates, `isWorking()` never cross-checks
  the new orthogonal intent state, `CancelOrder`'s existing fail-open path doesn't specify a resulting
  intent state, no eviction on the mutex map, and no optimistic-concurrency guard on terminal-state
  writes.
- **User directive**: "expand UI scope" — resolves objection (1). `product-spec.md`'s Consumer
  Surface(s) (C-14) amended to add the Place Order flow's client-nonce generation/reuse as a named,
  user-approved scope expansion (not a silent one); FR-1 updated to state the per-command-type intent-ID
  derivation split (client-nonce-seeded for Place, server-derived for Replace/Cancel).
  Round 2 will fold this decision in plus a resolution for objection (2) (P-03 deploy-overlap risk —
  adversary's suggested DB-native staleness/lease alternative, which also composes with 102's
  reconciliation ticker) and the remaining minor objections.
