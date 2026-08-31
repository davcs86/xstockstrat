# Feature: fundamentals-blend-universe

**Development Branch**: `feature/fundamentals-blend-universe`
**Created**: 2026-08-31
**Last Updated**: 2026-08-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-31 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fundamentals-blend-universe`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

In the live strategy evaluation loop, always additionally run the `fundamentals_macd_blend` strategy
over the **fundamentals universe** — symbols that both carry an active `source == "fundamentals"`
signal and actually have fundamentals data — on top of whatever strategy the user selected, while
constraining `fundamentals_macd_blend` to run **only** on that universe (excluded everywhere else).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` owner | Backtest/eval reproducibility, strategy scoring determinism, no look-ahead bias, universe-resolution correctness |
| `xstockstrat-config` owner | Config key naming (`analysis.engine.*`), scoping, WatchConfig wiring |
| `xstockstrat-ingest` owner | `QuerySignals(source="fundamentals")` contract (universe source of truth) |

## Next Action

`/sdd-review fundamentals-blend-universe product-spec` — AI review of product spec before running /sdd-spec
