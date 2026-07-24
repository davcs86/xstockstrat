# Feature: strategy-reentry-cooldown

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/strategy-reentry-cooldown`
**Created**: 2026-07-24
**Last Updated**: 2026-07-24

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-24 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-24 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-07-24 | `spec-ready` → `design-approved` | /sdd-design | Design debated (5 rounds, full) and approved; recon.md + design.md written |
| 2026-07-24 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 13 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, dependencies, risks
- [Design](design.md) — debated + approved architecture (5-round full debate)
- [Implementation Spec](implementation-spec.md) — 13 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add a configurable per-strategy re-entry cooldown (default 31 calendar days, chosen to sit outside
the U.S. wash-sale window) so a rule-based strategy's `entry_rule` cannot immediately refire on a
symbol on the very next bar after an exit, which today produces whipsaw re-entries during a
persistent decline. Reachable end-to-end: backend (backtest engine + live loop), the `manage_strategy`
MCP tool, and the `StrategyWizard` UI form all expose the new field.

## Reviewers

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-agent` (service owner) | `manage_strategy` MCP tool parameter/docstring accuracy, docs/runbooks/mcp-tools.md parity |
| `xstockstrat-ui` (service owner) | Strategy wizard form correctness, Connect-RPC call safety |
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal/type change without deprecation), naming conventions |
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness — new `009_strategy_cooldowns` migration |

## Next Action

`/sdd-review strategy-reentry-cooldown impl-spec` — validate the implementation spec, then `/sdd-execute strategy-reentry-cooldown`
