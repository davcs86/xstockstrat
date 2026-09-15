# Feature: opportunities-server-side-filters

**Development Branch**: `feature/opportunities-server-side-filters`
**Created**: 2026-09-15
**Last Updated**: 2026-09-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-15 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-15 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings; soft file overlaps with 187/188) |
| 2026-09-15 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) and approved; recon.md + design.md written; O1–O10 pins |
| 2026-09-15 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-09-15 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Steps 1–2: proto + codegen) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — chosen approach, rejected alternatives, O1–O10 pins (Phase 1.75)
- [Implementation Spec](implementation-spec.md) — 9 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Move the Opportunities List page's four controls (min-conviction floor, source multi-select,
action filter, sort) from client-side in-memory post-processing over a paginated infinite query
into true server-side execution in `analysis.ListOpportunities`, and add a server-computed
`available_sources` facet so the source chips stay complete and stable under pagination/filtering.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive (non-breaking) field additions, `buf lint`/`buf breaking` pass, `_UNSPECIFIED=0` sort/filter sentinels |
| `xstockstrat-analysis` owner | No look-ahead bias, deterministic ranking; filter/sort applied in SQL; muted/unavailable floor exemption preserved at the DB layer |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, query-key correctness under `refetchInterval`, no stale mount-persistent filter state |

## Next Action

`/sdd-review opportunities-server-side-filters impl-spec` — validate implementation spec, then `/sdd-execute opportunities-server-side-filters`
