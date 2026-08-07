# Feature: exit-cooldown

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/exit-cooldown`
**Created**: 2026-08-07
**Last Updated**: 2026-08-07

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-07 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-07 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-08-07 | `spec-ready` → `design-approved` | /sdd-design | Design debated (6 rounds, full — user overrode the standard 5-round cap for a final completeness audit) and approved; recon.md + design.md written |
| 2026-08-07 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 21 steps |
| 2026-08-07 | `implementation-ready` (unchanged) | /sdd-execute (sequential, re-spec gate) | Renumbered 110 → 116 (trunk collision); re-spec corrected 3 stale evidence citations (Steps 15, 18) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — 21 numbered steps, grounded in recon.md/design.md
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
| `xstockstrat-agent` (service owner) | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` (service owner) | Trading UI correctness, config mutation safety, Connect-RPC call safety |
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal/type change without deprecation), naming conventions |
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness — new migration for durable entry-timestamp state |

## Next Action

`/sdd-review exit-cooldown impl-spec` — validate implementation spec, then `/sdd-execute exit-cooldown`
