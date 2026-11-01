# Product Spec: expose-score-strategy-mcp

**Created**: 2026-11-01

---

## Problem Statement

`analysis.v1.AnalysisService/ScoreStrategy` recomputes and persists a strategy's cross-stock headline grade, but the agent registers no tool for it and no tool returns `evidence_symbols`. Operators and agents therefore cannot trigger the manual refresh after a scoring-config change, nor observe a grade's evidence provenance. Feature 215 Step 26 (e) ("a manual `ScoreStrategy` refresh leaves SCHD out of the grade's evidence") was never performed for this reason and still blocks 215 `launched`.

## User Story

As an operator driving the platform through the MCP agent, I want to refresh a strategy's headline grade and read its evidence provenance, so that I can verify grade-affecting changes (such as 215's evidence exclusion) without the UI or raw gRPC.

## Decisions (operator, 2026-11-01)

- **Tool shape: expand an existing tool — no new tool.** `ScoreStrategy` is exposed as a new `operation='score'` on `manage_strategy` (already the owner-gated write tool whose docstring documents grade clearing). `get_strategy` stays read-only and is not extended. The registered tool count therefore **stays forty-five**.
- **FR-5 mechanism: option C** — surface the `excluded` list `ScoreStrategy` already computes, with **no new `StrategyScore` proto field**. How analysis exposes it without a proto field is a design-phase question (`/sdd-design`); if no no-proto channel is viable the fork returns to the operator rather than silently adopting option A.
- **Authorization:** owner-scoped via the forwarded `x-user-id` (`_caller_user_id`), not admin-gated — matches `manage_strategy`/`set_strategy_live` since feature 133 and the analysis servicer's `get_by_owner_and_id` / `PERMISSION_DENIED`.
- **Merge order:** recorded in `docs/roadmap/features/merge-order.md` (215 waits for 283).

## Functional Requirements

FR-1. `manage_strategy` accepts `operation='score'` with `strategy_id`. It calls `ScoreStrategy` as the caller (owner-scoped via the forwarded `x-user-id`) and returns the resulting `StrategyScore` in snake_case: `strategy_id`, `overall_score`, `component_scores`, `rating`, `evidence_symbols`, `evidence_days`, `provisional`, `origin`. Every other `manage_strategy` argument is rejected for `score` (an actionable error, no backend call).
FR-2. The `manage_strategy` docstring states the `score` side effects: it recomputes and persists the grade and emits an `analysis.strategy.scored` ledger event, and the time range is ignored (the whole eligible evidence base is used).
FR-3. gRPC errors map to actionable messages: `PERMISSION_DENIED` (not owned/missing), `NOT_FOUND` (no eligible evidence; the stale grade is cleared — both the "run a backtest" and the "all evidence symbols excluded (fundamentals unavailable: …)" variants), `UNAVAILABLE` (store down, or fundamentals availability unknown with the grade unchanged).
FR-4. The `score` operation is documented in `docs/runbooks/mcp-tools.md` and the `strat-lab` `backtest` skill reference (same PR). No tool-count surface changes (count stays 45); an executable guard asserts the count surfaces still agree.
FR-5. A successful `score` result names the symbols the refresh excluded from the grade's evidence (215's check), not only how many contributed — via the `excluded` list `ScoreStrategy` already computes, without a new proto field (decision above).

## Out of Scope

- Changing `ScoreStrategy` semantics, the evidence derivation, or 215's guard.
- A new standalone MCP tool, or a read-only persisted-grade view (`get_strategy` is unchanged).
- A UI surface (the UI BFF already reaches `ScoreStrategy` via `insightsBff.ts`).
- Batch or scheduled re-scoring.
- Executing 215 Step 26 (e) itself — this feature only unblocks it.

## Affected Services

- `xstockstrat-agent` — `manage_strategy` `score` operation, client wrapper, docs.
- `xstockstrat-analysis` — only if option C needs the `excluded` list exposed on a no-proto channel (e.g. gRPC trailing metadata); the design decides.

## Consumer Surface(s)

- [ ] **UI** — none; already reachable through the `insights` BFF. The tool count is unchanged, so the UI's count surfaces (`copilot.ts`, `CopilotRail.tsx`) are not edited.
- [x] **Agent** — `xstockstrat-agent` MCP tool `manage_strategy` (new `score` operation); plus `strat-lab` `backtest` skill reference update in the same PR (root `CLAUDE.md` rule for strategy-API changes).
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes (option C adds no `StrategyScore` field). If the design finds no no-proto channel, this returns to the operator as a new fork (it does not auto-revert to an additive field).

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/expose-score-strategy-mcp` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (agent; plus analysis if option C needs an analysis change)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] FR-5 fork — resolved: option C (see Decisions).
- [x] Tool shape — resolved: expand `manage_strategy` with `operation='score'`.
- [x] Authorization — resolved: owner-scoped, not admin-gated.
- [x] Tool-count merge-order — resolved: count stays 45, no race with 281; 215↔283 ordering recorded in `merge-order.md`.
- [ ] _Design-phase:_ which no-proto channel carries `excluded` from analysis to the agent (trailing metadata vs. another existing field), and how `manage_strategy`'s `operation` validation/dispatch accommodates a read-shaped-args write op.
- **Known trap (ledger `fails.md` 2026-08-02 mcp-tools-alignment-triage):** MCP prose, runbook and `strat-lab` skill drift from `client.py`/protos. Design must add an executable parity guard (descriptor-parity test like `test_backtest_view.py`), not prose only.
