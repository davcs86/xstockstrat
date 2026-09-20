# Feature: opportunity-composite-score

**Development Branch**: `feature/opportunity-composite-score`
**Created**: 2026-09-20
**Last Updated**: 2026-09-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-20 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 advisory warnings; 0 blockers; no hard overlaps) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec opportunity-composite-score`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Persist a single 0–1 composite score per opportunity row (`user × symbol_norm × strategy_id`) that
fuses its multiple evidence types (readiness, decayed signal strength, fundamentals value+quality,
technical signal) via breadth-aware empirical-Bayes shrinkage — computed on the existing
opportunity-refresh write path in `xstockstrat-analysis`, alongside (never replacing) the existing
`conviction` and `signal_axis` axes.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ui` (service owner) | Analytics display accuracy, Connect-RPC call safety, no secret values rendered |
| `xstockstrat-agent` (service owner) | MCP tool contract stability (`list_opportunities` return shape), `docs/runbooks/mcp-tools.md` parity |
| Proto Reviewer | Additive-only field on `Opportunity`, field-number uniqueness, `buf breaking` passes |
| DBA | `analysis` migration NNN numbering (no gaps), up+down pair, column additivity |
| `xstockstrat-config` (service owner) | Config key naming (`analysis.scoring.*`), env/global-per-user scoping |

## Next Action

`/sdd-design opportunity-composite-score` — full design debate (resolve the ordinal-vs-probability normalization risk) before /sdd-spec
