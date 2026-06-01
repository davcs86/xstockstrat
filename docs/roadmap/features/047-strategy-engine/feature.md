# Feature: strategy-engine

**Lifecycle Status**: `draft`
**Development Branch**: `feature/strategy-engine`
**Created**: 2026-06-01
**Last Updated**: 2026-06-01

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-01 | `idea` → `draft` | /sdd-story | Product spec generated (originally `mcp-management-tools`) |
| 2026-06-01 | `draft` (revamp) | /sdd-story | Renamed `mcp-management-tools` → `strategy-engine`; rescoped to a first-class composable Strategy model + backtest integration + management tools. Continuous live→alert runtime split out to feature `048-live-strategy-alert-engine`. Renumbered 046→047 (046 taken by `align-frontend-e2e-bff-mocks`). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec strategy-engine`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make **Strategy** a first-class, persisted entity in `xstockstrat-analysis`: a named definition
that composes **multiple indicators and/or custom formulas** with explicit **entry/exit rules**
and optional newsletter-signal weighting. Replace the hardwired SMA-crossover backtest with a
shared **strategy evaluator** that runs a stored strategy in `RunBacktest`, and add admin-scoped
MCP management tools (`manage_strategy`, `manage_formula`, `manage_signal_source`). The same
evaluator is reused by the continuous live→alert runtime in feature
`048-live-strategy-alert-engine` to guarantee backtest/live parity.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias, evaluator parity between backtest and live |
| `xstockstrat-indicators` (service owner) | Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution (formula components) |
| `xstockstrat-ingest` (service owner) | Signal normalization, newsletter source schema stability (signal-weighting inputs) |
| `xstockstrat-agent` (service owner) | MCP management-tool correctness, admin-scope enforcement, `x-mcp-secret` propagation _(note: agent not yet in reviewer-registry Service Owners table — registry gap)_ |
| Proto Reviewer | Field number uniqueness, additive/non-breaking changes for new strategy + evaluator RPCs/messages |
| DBA | New `analysis.strategies` migration: NNN numbering, up+down pair, index/partition correctness |
| Security | Admin API key scoping on mutating MCP tools, `secret.*` handling for any credential refs |

## Next Action

`/sdd-review strategy-engine product-spec` — AI review of product spec before running /sdd-spec
