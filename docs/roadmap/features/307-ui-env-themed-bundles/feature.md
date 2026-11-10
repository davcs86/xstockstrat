# Feature: ui-env-themed-bundles

**Development Branch**: `feature/ui-env-themed-bundles`
**Created**: 2026-11-10
**Last Updated**: 2026-11-10

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-10 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ui-env-themed-bundles`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Build `xstockstrat-ui` as separate, environment-specific bundles selected by a build-time `UI_THEME` argument: staging keeps the Nocturne palette, production gets a new theme. Content and behavior are unchanged.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` owner | Trading UI correctness, environment (`production`/`staging`) scope correctness, analytics display accuracy |

## Next Action

`/sdd-review ui-env-themed-bundles product-spec` — AI review of product spec before running /sdd-spec
