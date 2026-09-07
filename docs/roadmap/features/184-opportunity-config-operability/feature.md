# Feature: opportunity-config-operability

**Development Branch**: `feature/opportunity-config-operability`
**Created**: 2026-09-07
**Last Updated**: 2026-09-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-07 | `idea` → `draft` | /sdd-story | Product spec generated (opportunities-queue audit follow-up) |
| 2026-09-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings; FR-6 kill-switch demoted to design option to clear C-15/criterion-8 blocker) |
| 2026-09-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Justified-set (~10) bounds scope chosen; kill-switch + get_float_present fix routed to feature 185 |
| 2026-09-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-09-07 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — migration 028 seeds the 15 analysis.opportunity.* keys (config-only) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules (C-16), risks
- [Design](design.md) — debated & approved architecture, rejected alternatives, open risks, Constitution rules touched
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Apply the feature-182 config-operability philosophy to the opportunities queue: register the
`analysis.opportunity.*` config keys (currently the invisible no-seed pattern) via a seed migration so
they appear in config-ui, and add server-side `SCALAR_BOUNDS_REGISTRY` write-bounds to the numeric
footgun keys — closing the "operator can't see/tune, and can set unsafe values" gap the audit found.

## Reviewers

_(Snapshot from docs/runbooks/reviewer-registry.md, finalized at /sdd-spec time from the distinct
per-step reviewers. Stable unless /sdd-spec re-runs.)_

| Role | Review Focus |
|---|---|
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order compliance (Step 1) |
| xstockstrat-config owner | Config seed migration correctness, key naming/scoping, bounds registry, WatchConfig stream stability, registered-keys log (Steps 1–3) |
| xstockstrat-ui owner | config-ui mutation safety, environment scope correctness, e2e fixture (C-12) (Step 4) |

## Next Action

`/sdd-review opportunity-config-operability impl-spec` — validate implementation spec, then `/sdd-execute opportunity-config-operability`
