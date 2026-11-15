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

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec chart-series-palette`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Give indicator chart series distinguishable colors: a dedicated 12-color categorical series palette in both themes, assigned uniquely across the whole chart, with matching legend swatches.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-ui` | Trading UI correctness, analytics display accuracy, Connect-RPC call safety |

## Next Action

`/sdd-design chart-series-palette` — quick design recommended (single service, no proto, no schema change, no overlap finding); append `quick` to take it
