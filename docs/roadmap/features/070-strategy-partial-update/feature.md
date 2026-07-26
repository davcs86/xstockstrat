# Feature: strategy-partial-update

**Lifecycle Status**: `draft`
**Development Branch**: `feature/strategy-partial-update`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec strategy-partial-update`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make `manage_strategy` "update" apply a **partial merge** instead of a destructive full-replace, so
changing a single field (e.g. `cooldown_days`) no longer silently drops a strategy's indicator
components and entry/exit rules. Add a strategy **read** operation and reject updates that would
orphan rule-referenced components, so parameter tuning can no longer corrupt a definition.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change
types. Override as needed for this feature. Snapshot finalized at /sdd-spec time — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias; `ManageStrategy` merge correctness |
| `xstockstrat-agent` (service owner) | `manage_strategy` MCP tool parameter/docstring accuracy, partial-update semantics, `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` (service owner) | `StrategyWizard` edit-path correctness under partial updates, Connect-RPC call safety |
| Proto Reviewer | Field-number uniqueness, backward compatibility (`update_mask` / new patch RPC / `GetStrategy` — no field removal or type change without deprecation) |

## Next Action

`/sdd-review strategy-partial-update product-spec` — AI review of product spec before running /sdd-spec
