# Feature: expose-score-strategy-mcp

**Development Branch**: `feature/expose-score-strategy-mcp`
**Created**: 2026-11-01
**Last Updated**: 2026-11-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-01 | `idea` → `draft` | /sdd-story | Product spec generated (gap from 215 Step 26 (e)) |
| 2026-11-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved (6 warnings; first pass FAILED on open questions, resolved by operator) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec expose-score-strategy-mcp`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The `ScoreStrategy` RPC (manual headline-grade refresh) and its provenance fields (`evidence_symbols`, `evidence_days`, `provisional`) have no MCP tool, so an agent or operator cannot trigger or verify a grade recompute. Feature 215 Step 26 (e) was blocked on exactly this.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; no secret values in tool output or the unauthenticated `GET /api/tools` catalog |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias (only if the open proto fork is taken) |
| Proto Reviewer + `packages/proto` owner | Only if the additive-field option is chosen: field number uniqueness, `buf lint`/`buf breaking` |

## Next Action

`/sdd-design expose-score-strategy-mcp` — full design recommended (same-function overlap with 215 on `manage_strategy`; option C may touch `xstockstrat-analysis`; `score` has no `STRATEGY_OPERATION_*` enum and needs separate RPC dispatch)
