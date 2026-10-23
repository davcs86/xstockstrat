# Feature: enforce-config-key-wiring

**Development Branch**: `feature/enforce-config-key-wiring`
**Created**: 2026-10-23
**Last Updated**: 2026-10-23

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-23 | `idea` → `draft` | /sdd-story | Product spec generated; follow-up created by the operator when demoting 277-fix-ingest-seeded-config-keys |
| 2026-10-23 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings) |
| 2026-10-23 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — approved design, rejected alternatives, open risks
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec enforce-config-key-wiring`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A deterministic check, wired into the execution/validation loop and CI, that proves every config key a feature seeds is read by code under the exact stored key (and every key code reads is seeded), so a config key can no longer ship as a silent no-op.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture; the check spans every service and the SDD skills |
| `xstockstrat-config` owner | Config key naming (`<service>.<category>.<key>`), environment/global-per-user scoping, WatchConfig stream stability |

## Next Action

`/sdd-spec enforce-config-key-wiring` — generate implementation spec from the approved design
