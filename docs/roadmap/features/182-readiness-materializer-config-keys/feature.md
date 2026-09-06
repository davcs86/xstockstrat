# Feature: readiness-materializer-config-keys

**Development Branch**: `feature/readiness-materializer-config-keys`
**Created**: 2026-09-06
**Last Updated**: 2026-09-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-06 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-06 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings); overlap CLEAN |
| 2026-09-06 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Operator chose "all four keys + write-bounds" (max_concurrent_bars_fetches ceiling=5) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier (/sdd-design Phase 0)
- [Design](design.md) — debated, approved architecture (/sdd-design Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Register the `analysis.readiness_materializer.*` config keys via a config seed migration (mirroring
`026_analysis_engine_blend_keys`) so they appear in config-ui and can be toggled by an admin — closing
the gap where the feature-180 readiness materializer cannot be enabled because its keys are
unregistered and config-ui cannot create arbitrary keys.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Config service owner | Config seed migration correctness, key naming/scoping, registered-keys log |
| Analysis service owner | Key names/defaults match the analysis reader getters (feature 180) |

## Next Action

`/sdd-spec readiness-materializer-config-keys` — generate implementation spec from the approved design
