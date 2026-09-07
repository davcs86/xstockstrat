# Feature: opportunity-compute-robustness

**Development Branch**: `feature/opportunity-compute-robustness`
**Created**: 2026-09-07
**Last Updated**: 2026-09-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-07 | `idea` → `draft` | /sdd-story | Product spec generated (opportunities-queue audit follow-up) |
| 2026-09-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory; FR-4 cold-read demoted to design option to clear C-15/criterion-8 blocker; C-14 agent + C-16 turned into design Open Questions) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Apply the feature-181/176 correctness philosophy to the opportunities compute: give it a
**data-unavailable sentinel** (so a bars-fetch failure surfaces as a terminal "unavailable" state, not
a misleading `0/0` quiet row), and a **dedicated background bars-fetch semaphore** separate from the
interactive read path (the feature-176/180 priority-inversion guard the materializer already has).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time.)_

| Role | Review Focus |
|---|---|
| xstockstrat-analysis owner | Opportunity compute semantics, sentinel representation, semaphore isolation, materialized-row meaning |
| Proto owners (if a field is added) | `Opportunity` message change — additive, non-breaking; enum zero-value sentinel (C-04) |
| xstockstrat-ui owner | Rendering the new unavailable/unknown state (C-17 primitives) |

## Next Action

`/sdd-design opportunity-compute-robustness` — recon + FULL design debate (proto/sentinel fork) before /sdd-spec
