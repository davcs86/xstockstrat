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
