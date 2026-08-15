# Feature: symbol-page-section-nav

**Lifecycle Status**: `draft`
**Development Branch**: `feature/symbol-page-section-nav`
**Created**: 2026-08-15
**Last Updated**: 2026-08-15

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-15 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec symbol-page-section-nav`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Group the many stacked sections of the unified Symbol page (`/trader/positions/[symbol]`, feature 125)
into a same-page navigation pattern (tabs, sticky segmented section-nav, or anchored jump-links —
decided at `/sdd-design`) so a trader can move between logical section groups without scrolling the
whole page, on desktop and mobile.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access |

## Next Action

`/sdd-review symbol-page-section-nav product-spec` — AI review of product spec before running /sdd-spec
