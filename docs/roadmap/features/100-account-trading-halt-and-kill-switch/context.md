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

## Session 2026-08-05T00:00:00Z — sdd-review product-spec (2 rounds)

- Round 1 FAIL: (1) the Problem Statement/FR-1 doc-drift claim was stale —
  `services/xstockstrat-trading/CLAUDE.md:63` already documents `platform.maintenance_mode` correctly;
  the cited findings-doc entry is dated 2026-07-24 and no longer reflects trunk. (2) C-3 trading-domain
  gap: no statement of whether the halt states are scoped per `trading_mode` (paper/live). Fixed:
  rewrote the Problem Statement/FR-1 to a verification-only step (do not rename a working key on stale
  evidence), and added explicit per-`trading_mode` config-seeding guidance (independent paper/live halt
  rows, not `trading_mode='all'`) so an operator can halt live without freezing paper testing.
- Round 2: **PASS WITH WARNINGS** (3 advisory: `platform.*` 2-segment key format is an inherited,
  pre-existing exception not new debt; 3 Open Questions correctly deferred to `/sdd-design`; C-4 order
  type coverage not explicitly stated). Status: `draft` → `spec-ready`.
