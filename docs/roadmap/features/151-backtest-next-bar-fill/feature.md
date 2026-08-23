# Feature: backtest-next-bar-fill

**Development Branch**: `feature/backtest-next-bar-fill` (this session's work rides `claude/xstockstrat-metrics-sweep-m070rf` per the harness branch constraint)
**Created**: 2026-08-23
**Last Updated**: 2026-08-23

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-23 | `idea` → `draft` | /sdd-story | Product spec generated from metrics-sweep audit finding #3 |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-next-bar-fill`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The backtest engine fills entries, exits, and the `vts` stop at the **same bar's close** — the very
bar whose close produced the signal — a mild look-ahead / unrealistically-optimistic fill. Move fills
to the **next bar's open** (opt-in, versioned), the standard bias-free convention, so backtest results
better predict live behavior.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md; finalized at /sdd-spec.)_

| Role | Review Focus |
|---|---|
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** |
| Proto owner (if a fill-model field is added) | Non-breaking additive field; enum→TS exhaustive-map coupling (ledger 067) |

## Next Action

`/sdd-design backtest-next-bar-fill quick` — ground and debate the design (operator chose story+design only; stop before /sdd-spec)
