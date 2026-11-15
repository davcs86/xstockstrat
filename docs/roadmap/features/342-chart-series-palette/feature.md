# Feature: chart-series-palette

**Development Branch**: `feature/chart-series-palette`
**Created**: 2026-11-15
**Last Updated**: 2026-11-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-15 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings) |
| 2026-11-15 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + debate.md + design.md written |
| 2026-11-15 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — settled decisions, rejected alternatives, objections
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 10 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Give indicator chart series distinguishable colors: a dedicated 12-color categorical series palette in both themes, assigned uniquely across the whole chart, with matching legend swatches.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-15 from docs/runbooks/reviewer-registry.md and the
steps' `**Reviewers**` lines. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-ui` | Trading UI correctness, analytics display accuracy (Steps 1, 2, 4-9; `service` and `test`) |

Steps 3 and 10 are `docs` steps: no reviewer.

## Next Action

`/sdd-review chart-series-palette impl-spec` — validate implementation spec, then `/sdd-execute chart-series-palette`
