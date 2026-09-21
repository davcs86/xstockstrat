# Feature: sparkline-ohlc-replacement

**Development Branch**: `feature/sparkline-ohlc-replacement`
**Created**: 2026-09-11
**Last Updated**: 2026-09-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-11 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written |
| 2026-09-11 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated (8 steps, UI-only) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — codebase map, patterns, business rules
- [Design](design.md) — debated architecture (2 rounds, quick)
- [Implementation Spec](implementation-spec.md) — 8 steps, UI-only (xstockstrat-ui)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the sparkline bar chart on the Opportunities List page and the Single Opportunity (symbol detail) page with the previous trading day's OHLC price data rendered as text next to the date.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI, no direct DB access (except audit log) |

## Next Action

`/sdd-review sparkline-ohlc-replacement impl-spec` — then `/sdd-execute sparkline-ohlc-replacement`
