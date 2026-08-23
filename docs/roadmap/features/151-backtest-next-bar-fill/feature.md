# Feature: backtest-next-bar-fill

**Development Branch**: `feature/backtest-next-bar-fill` (this session's work rides `claude/xstockstrat-metrics-sweep-m070rf` per the harness branch constraint)
**Created**: 2026-08-23
**Last Updated**: 2026-08-23

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-23 | `idea` → `draft` | /sdd-story | Product spec generated from metrics-sweep audit finding #3 |
| 2026-08-23 | `draft` → `design-approved` | /sdd-design | Design debated (7 rounds, full; cap raised 5→7) and approved; recon.md + design.md written. Terminal verdict APPROVABLE, no Floor breach. |
| 2026-08-23 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 10 steps |
| 2026-08-23 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1–3 (proto fill_model 9/20/18 + codegen + migration 018) done on claude/xstockstrat-metrics-sweep-m070rf |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The backtest engine fills entries, exits, and the `vts` stop at the **same bar's close** — the very
bar whose close produced the signal — a mild look-ahead / unrealistically-optimistic fill. Move fills
to the **next bar's open** (opt-in, versioned), the standard bias-free convention, so backtest results
better predict live behavior.

## Reviewers

_(Finalized snapshot from docs/runbooks/reviewer-registry.md at /sdd-spec — stable unless /sdd-spec re-runs.)_

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, no breaking change, `buf lint`/`buf breaking` | 1, 2 |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** | 1, 2, 3, 4, 5 |
| DBA | Migration NNN numbering, up+down pair, additive-only | 3 |
| xstockstrat-agent owner | MCP tool contract stability (name, parameters, return shape) + `docs/runbooks/mcp-tools.md` parity | 6, 7 |
| xstockstrat-ui owner | Analytics display accuracy, enum→TS exhaustive-map coupling (ledger 067) | 9, 10 |

(Step 8 is docs — no reviewer per the governance matrix.)

## Next Action

`/sdd-review backtest-next-bar-fill impl-spec` — validate the implementation spec, then `/sdd-execute backtest-next-bar-fill`
