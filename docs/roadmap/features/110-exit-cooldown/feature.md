# Feature: exit-cooldown

**Lifecycle Status**: `draft`
**Development Branch**: `feature/exit-cooldown`
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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec exit-cooldown`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a configurable per-strategy exit cooldown (minimum holding period in calendar days) so a
rule-based strategy's `exit_rule` cannot fire and sell a position before it has been held for at
least N days, mirroring the existing re-entry cooldown (feature 069) but gating the opposite
transition. Reachable end-to-end: backend (backtest engine + live loop), the `manage_strategy` MCP
tool, and the `StrategyWizard` UI form (Step 1 — Identity, alongside "Re-entry cooldown (days)").

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-agent` (service owner) | `manage_strategy` MCP tool parameter/docstring accuracy, `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` (service owner) | Strategy wizard form correctness, Connect-RPC call safety |
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal/type change without deprecation), naming conventions |
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness — new migration for durable entry-timestamp state |

## Next Action

`/sdd-review exit-cooldown product-spec` — AI review of product spec before running /sdd-design
