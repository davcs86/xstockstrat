# Feature: trader-chart-panel

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/trader-chart-panel`
**Created**: 2026-05-20
**Last Updated**: 2026-05-20

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-20 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-20 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning: 012-wire-fe-auth also modifies xstockstrat-trader — advisory merge order) |
| 2026-05-20 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add an OHLCV candlestick chart panel to the `xstockstrat-trader` UI. The chart polls `GetBars` on a configurable interval (no streaming required given 5m minimum timeframe) and supports a symbol selector and timeframe switcher (1m, 5m, 15m, 1h, 1d). Backend RPCs, service logic, and DB layer are fully implemented — only the frontend component is missing.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-trader` owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |

## Next Action

`/sdd-review trader-chart-panel impl-spec` — validate implementation spec, then `/sdd-execute trader-chart-panel`
