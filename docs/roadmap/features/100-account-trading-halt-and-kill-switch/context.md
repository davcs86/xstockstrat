# Context: account-trading-halt-and-kill-switch

**Feature**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/feature.md`
**Product Spec**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/implementation-spec.md`

---

## Session 2026-08-04T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from an external live-capital
  safety risk review (session-provided feedback document, not a GitHub issue). The review recommended
  a dedicated Live-Capital Safety program with P0/P1/P2 items; this feature is P0 item 3
  ("account-level trading kill switch").
- Source feedback also recommended accelerating two existing draft features as P0 blockers rather than
  creating new ones for them: `023-position-sizing-engine` and `030-stop-loss-bracket-orders`. Their
  `context.md` files were annotated with a priority note pointing back to this program; no new feature
  numbers were allocated for them.
- This feature is a foundational dependency for 102 (reconciliation halts through it), 106 (market-data
  gate halts through it), and 107 (canary rollout enforces stage limits at the same gate). Per the
  review's suggested execution order, this and 101 (idempotent order intents) have no upstream
  dependency and can start first.

## Session 2026-08-04T01:00:00Z — feasibility re-check (rescoped, not demoted)

- The user pushed back on the mechanical translation and asked for a real feasibility check. Grepping
  `services/xstockstrat-trading/internal/service/trading.go` found `platform.maintenance_mode` is
  **already** read synchronously inside `PlaceOrder` (`trading.go:244`) — a real, already-enforced
  kill switch, not a green-field gap. A doc/code key-name drift is already flagged in
  `services/xstockstrat-trading/docs/context-constitution-findings.md:13`.
- Kept in the backlog (unlike 102/103/104/105/106/107/108/109, which were demoted — see their
  context.md files) because a halt is valuable regardless of whether order flow is human-initiated or
  automated. But rewrote `product-spec.md` to reflect the real, much smaller scope: harden the
  existing key into a richer enum, verify every handler checks it, audit via the existing ledger
  event store (no new DB table, no new proto message — reusing the `insights.md` 2026-07-31 pattern of
  append-only-store-instead-of-new-table). Dropped every *automatic* trigger (loss threshold,
  drawdown, reconciliation, stale data) since those either depend on demoted features or on an
  automated order-placement path this platform doesn't have yet.
