# Feature: backtest-debug-info

**Lifecycle Status**: `draft`
**Development Branch**: `feature/backtest-debug-info`
**Created**: 2026-07-08
**Last Updated**: 2026-07-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-08 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-debug-info`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Surface full day-by-day backtest diagnostics — per-bar OHLCV, computed indicator series, warm-up
markers, per-bar signal scores, and the entry/exit/conviction decision the engine made — so a
strategy author can see *why* a backtest produced 0 trades even when data coverage is sufficient.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, additive-only (no breaking changes without deprecation), `buf lint`/`buf breaking` pass |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** in the emitted per-bar diagnostics |
| `xstockstrat-ui` (service owner) | Analytics display accuracy, Connect-RPC call safety, no direct DB access, large-table render performance |

## Next Action

`/sdd-review backtest-debug-info product-spec` — AI review of product spec before running /sdd-spec
