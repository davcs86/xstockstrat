# Feature: unify-symbol-chart-libraries

**Development Branch**: `feature/unify-symbol-chart-libraries`
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

On the trader symbol page (`/trader/positions/[symbol]`), unify the presentation of the OHLCV price
chart (`lightweight-charts`) and the indicator overlay panels (`recharts`) so they read as one
instrument with a single, aligned time axis and a consistent visual language — resolving the
follow-up left open by PR #980, which harmonized only the panels' card framing.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` service owner | Trading UI correctness, analytics display accuracy, Connect-RPC call safety, environment scope correctness (chart rendering + e2e stability) |

## Next Action

`/sdd-review unify-symbol-chart-libraries product-spec` — AI review of product spec before running /sdd-spec
