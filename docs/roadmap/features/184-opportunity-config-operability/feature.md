# Feature: opportunity-config-operability

**Development Branch**: `feature/opportunity-config-operability`
**Created**: 2026-09-07
**Last Updated**: 2026-09-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-07 | `idea` → `draft` | /sdd-story | Product spec generated (opportunities-queue audit follow-up) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Apply the feature-182 config-operability philosophy to the opportunities queue: register the
`analysis.opportunity.*` config keys (currently the invisible no-seed pattern) via a seed migration so
they appear in config-ui, and add server-side `SCALAR_BOUNDS_REGISTRY` write-bounds to the numeric
footgun keys — closing the "operator can't see/tune, and can set unsafe values" gap the audit found.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time.)_

| Role | Review Focus |
|---|---|
| xstockstrat-config owner | Config seed migration correctness, key naming/scoping, bounds registry, registered-keys log |
| xstockstrat-analysis owner | Bound ranges match each key's reader semantics/clamps (opportunity compute + refresh loop) |

## Next Action

`/sdd-review opportunity-config-operability product-spec` — AI review before /sdd-design
