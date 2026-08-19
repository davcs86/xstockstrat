# Feature: unify-symbol-chart-libraries

**Development Branch**: `feature/unify-symbol-chart-libraries`
**Created**: 2026-08-18
**Last Updated**: 2026-08-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-18 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-18 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings addressed: AC-2 token backstop, feature-123 decision dependency; rebase note recorded) |
| 2026-08-18 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Fork (a) at live gate: indicators onto lightweight-charts **v5 native panes**, drop recharts from symbol page, shared crosshair in-scope |
| 2026-08-18 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (8 steps; split to 9 after /sdd-review impl-spec — shared crosshair/tooltip is its own step) |
| 2026-08-18 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — pinned lightweight-charts v5.2.1, verified pane/series/whitespace API |
| 2026-08-18 | `in-progress` → `code-completed` | /sdd-execute | All 9 steps done — v5 multi-pane symbol chart (price + indicator panes, one instance), shared crosshair/tooltip, recharts dropped from symbol page, CLAUDE.md updated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map (/sdd-design Phase 0)
- [Design](design.md) — debated, approved architecture (/sdd-design Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

On the trader symbol page (`/trader/positions/[symbol]`), unify the presentation of the OHLCV price
chart (`lightweight-charts`) and the indicator overlay panels (`recharts`) so they read as one
instrument with a single, aligned time axis and a consistent visual language — resolving the
follow-up left open by PR #980, which harmonized only the panels' card framing.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness — chart rendering + e2e stability (v5 migration, one pane per component / all sub-series drawn / gaps-not-0, disposal-safe teardown, `.tv-lightweight-charts` readiness preserved, card→panes layout change) |

_All 9 steps are `service`/`test`/`docs` in `xstockstrat-ui`; the single distinct reviewer above is
the `xstockstrat-ui` service owner (the `docs` step, Step 9, carries no reviewer per the registry
matrix)._

## Next Action

`/sdd-review unify-symbol-chart-libraries impl-spec` — validate the implementation spec, then
`/sdd-execute unify-symbol-chart-libraries`
