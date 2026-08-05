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
