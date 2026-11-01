# Product Spec: expose-score-strategy-mcp

**Created**: 2026-11-01

---

## Problem Statement

`analysis.v1.AnalysisService/ScoreStrategy` recomputes and persists a strategy's cross-stock headline grade, but the agent registers no tool for it and no tool returns `evidence_symbols`. Operators and agents therefore cannot trigger the manual refresh after a scoring-config change, nor observe a grade's evidence provenance. Feature 215 Step 26 (e) ("a manual `ScoreStrategy` refresh leaves SCHD out of the grade's evidence") was never performed for this reason and still blocks 215 `launched`.

## User Story

As an operator driving the platform through the MCP agent, I want to refresh a strategy's headline grade and read its evidence provenance, so that I can verify grade-affecting changes (such as 215's evidence exclusion) without the UI or raw gRPC.

## Functional Requirements

FR-1. A new agent tool `score_strategy(strategy_id)` calls `ScoreStrategy` as the caller (owner-scoped via the forwarded `x-user-id`) and returns the resulting `StrategyScore` in snake_case: `strategy_id`, `overall_score`, `component_scores`, `rating`, `evidence_symbols`, `evidence_days`, `provisional`, `origin`.
FR-2. The tool's docstring states the side effects: it recomputes and persists the grade and emits an `analysis.strategy.scored` ledger event, and `range` is ignored (the whole eligible evidence base is used).
FR-3. gRPC errors map to actionable messages: `PERMISSION_DENIED` (not owned/missing), `NOT_FOUND` (no eligible evidence; the stale grade is cleared), `UNAVAILABLE` (store down, or fundamentals availability unknown with the grade unchanged).
FR-4. The tool is documented in `docs/runbooks/mcp-tools.md`, the `strat-lab` `backtest` skill reference, and every tool-count surface is bumped (45 → 46).
FR-5. Operators can tell which symbols a refresh excluded (215's check), not only how many contributed. _The mechanism is an open fork (see Open Questions)._

## Out of Scope

- Changing `ScoreStrategy` semantics, the evidence derivation, or 215's guard.
- A UI surface (the UI BFF already reaches `ScoreStrategy` via `insightsBff.ts`).
- Batch or scheduled re-scoring.
- Executing 215 Step 26 (e) itself — this feature only unblocks it.

## Affected Services

- `xstockstrat-agent` — new tool, client wrapper, docs, tool-count surfaces.
- `xstockstrat-analysis` — only if FR-5 is met by an additive proto field.
- `packages/proto` — only if FR-5 is met by an additive proto field.

## Consumer Surface(s)

- [ ] **UI** — none; already reachable through the `insights` BFF.
- [x] **Agent** — `xstockstrat-agent` MCP tool `score_strategy` (new); plus `strat-lab` `backtest` skill reference update in the same PR (root `CLAUDE.md` rule for strategy-API changes).
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required for FR-1..FR-4
- FR-5 may add an additive field to `StrategyScore` (see Open Questions).

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/expose-score-strategy-mcp` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (agent; plus analysis/proto if FR-5 adds a field)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **FR-5 fork — how to show excluded symbols.** `StrategyScore.evidence_symbols` is an `int32` count (`analysis.proto:255`), so a refresh can't name SCHD. Options: (A) additive `repeated string excluded_symbols` on `StrategyScore` (proto + analysis change, richest); (B) tool returns only the count and the operator compares before/after counts with SCHD added/removed (no proto, weaker proof); (C) surface the `excluded` list already computed in `ScoreStrategy` as a response `warnings` field in the tool only if analysis exposes it. Operator to choose at design.
- [ ] Tool shape: standalone `score_strategy` write tool vs also exposing the persisted grade read-only via `get_strategy`/`GetStrategyReport`. The story requires only the refresh; a read-only grade view is not in scope unless chosen.
- [ ] Authorization: `ScoreStrategy` is owner-scoped, not admin-gated; confirm no `_caller_access_scope` admin check is wanted (constitution: admin scope only on management tools).
- [ ] Tool-count merge-order: any in-flight feature that also adds a tool (e.g. 281) races on the six count surfaces; whichever lands second re-bumps.
- **Known trap (ledger `fails.md` 2026-08-02 mcp-tools-alignment-triage):** MCP prose, runbook and `strat-lab` skill drift from `client.py`/protos. Design must add an executable parity guard (descriptor-parity test like `test_backtest_view.py`), not prose only.
