# Context: expose-score-strategy-mcp

**Feature**: `docs/roadmap/features/283-expose-score-strategy-mcp/feature.md`
**Product Spec**: `docs/roadmap/features/283-expose-score-strategy-mcp/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/283-expose-score-strategy-mcp/implementation-spec.md`

---

## Session 2026-11-01 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the operator's request to close the 215 Step 26 (e) gap.
- Number 283 = max(282)+1 on `origin/main-dev` `0fc13c41`, so no renumbering.
- Origin: `docs/roadmap/features/215-block-fundamentals-strategy-on-etf/implementation-spec.md` § Deviation "Step 26 (e) — `ScoreStrategy` not reachable via MCP" (blocks 215 `launched`).
- Facts grounded: `ScoreStrategy` at `services/xstockstrat-analysis/app/handlers/servicer.py:2566` (owner-scoped, `range` ignored, persists grade, emits `analysis.strategy.scored`); `StrategyScore` at `packages/proto/analysis/v1/analysis.proto:249-258` (`evidence_symbols` is an `int32` count); agent registers 45 tools today.
- Unresolved: FR-5 fork (how to name excluded symbols) — raised in product-spec Open Questions, not guessed.
