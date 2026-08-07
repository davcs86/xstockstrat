# Feature: screener-fundamental-metric-selector

**Lifecycle Status**: `draft`
**Development Branch**: `feature/screener-fundamental-metric-selector`
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the Screener page's free-text "Fundamental" metric-name field with a select dropdown
populated from the closed set of fundamental metric names the backend already validates against,
matching the existing select-driven pattern used for the Technical indicator field on the same page.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI |

## Next Action

`/sdd-review screener-fundamental-metric-selector product-spec` — AI review of product spec before running /sdd-spec
