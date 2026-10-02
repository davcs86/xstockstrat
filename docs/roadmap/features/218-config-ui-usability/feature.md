# Feature: config-ui-usability

**Development Branch**: `feature/config-ui-usability`
**Created**: 2026-10-02
**Last Updated**: 2026-10-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-02 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec config-ui-usability`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Usability pass over the `/config-ui` namespace editor: a namespace dropdown above the keys table
replaces the landing card grid, each row shows a clamped description and its last-updated timestamp
(new `ConfigKeyMeta.updated_at`), and inline editing stops stealing focus back to the value input.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, no breaking changes, `buf lint` + `buf breaking` pass |
| `xstockstrat-config` owner | Environment / global-per-user scoping, secret redaction at the ListKeys edge |
| `xstockstrat-ui` owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-review config-ui-usability product-spec` — AI review of product spec before running /sdd-spec
