# Feature: symbol-page-panel-refinements

**Development Branch**: `feature/symbol-page-panel-refinements` (harness branch: `claude/symbol-page-ui-refinements-t2xp26`)
**Created**: 2026-08-18
**Last Updated**: 2026-08-18

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-18 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Refine the trader symbol page (`/trader/positions/[symbol]`, feature 139's section-nav layout) so
every section follows the Card/panel pattern, redundant broken panels are removed, Fundamentals is
always-on, and a single user-controllable strategy selection drives the Indicators / Backtests /
"Why this fired" panels so they are no longer dead-ends for symbols like AMZN.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access |

## Next Action

`/sdd-review symbol-page-panel-refinements product-spec` — AI review of product spec before running /sdd-spec
