# Feature: backtest-time-window

**Lifecycle Status**: `draft`
**Development Branch**: `feature/backtest-time-window`
**Created**: 2026-07-26
**Last Updated**: 2026-07-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-26 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-time-window`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let `run_backtest` accept an explicit `start`/`end` window (with enough pre-window history to warm up
indicators), instead of only a fixed rolling window ending "today." Unblocks temporal
out-of-sample / walk-forward validation and makes backtest results deterministic across calendar
days.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change
types. Override as needed for this feature. Snapshot finalized at /sdd-spec time — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, no look-ahead bias; window + indicator warm-up correctness (pre-window history must not leak future data) |
| `xstockstrat-agent` (service owner) | `run_backtest` MCP tool parameter/docstring accuracy, `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` (service owner) | Backtest form / `BacktestDiagnostics` correctness if a window is exposed in the UI, Connect-RPC call safety |
| Proto Reviewer | Field-number uniqueness, backward compatibility (additive `start`/`end` on `RunBacktest` request — no field removal or type change) |

## Next Action

`/sdd-review backtest-time-window product-spec` — AI review of product spec before running /sdd-spec
