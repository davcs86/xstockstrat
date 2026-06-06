# Feature: strategy-engine

**Lifecycle Status**: `code-completed`
**Development Branch**: `feature/strategy-engine`
**Created**: 2026-06-01
**Last Updated**: 2026-06-05

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-01 | `idea` → `draft` | /sdd-story | Product spec generated (originally `mcp-management-tools`) |
| 2026-06-01 | `draft` (revamp) | /sdd-story | Renamed `mcp-management-tools` → `strategy-engine`; rescoped to a first-class composable Strategy model + backtest integration + management tools. Continuous live→alert runtime split out to feature `048-live-strategy-alert-engine`. Renumbered 046→047 (046 taken by `align-frontend-e2e-bff-mocks`). |
| 2026-06-04 | `draft` → `spec-ready` | /sdd-review | Product spec approved (4 warnings — advisory). All 7 open questions resolved: JSON condition tree rule model, evaluator in xstockstrat-analysis, both strategy_id+inline_definition for RunBacktest, ListStrategyDefinitions added, signals-as-rule-term deferred, ListFormulas from feature 003, agent reviewer-registry gap noted. |
| 2026-06-04 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps. |
| 2026-06-04 | `implementation-ready` (re-spec) | /sdd-spec | Implementation spec refreshed with updated codebase evidence: INGEST_ENDPOINT absent from analysis docker-compose/DO specs added to Step 4; IDENTITY_ENDPOINT and IDENTITY_ENDPOINT absence confirmed fresh; claude_mcp_config.json does not enumerate tool names (Step 10 corrected); line number references updated from live codebase reads. |
| 2026-06-05 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Step 1 — proto messages/RPCs added to analysis.proto; buf lint + breaking clean). |
| 2026-06-05 | `in-progress` → `code-completed` | /sdd-execute | All 14 steps done (stacked per-step PRs #566–#579). analysis 83 tests / 53.69% cov, agent 31 tests / 57.77% cov; buf+codegen clean; migration up/down verified. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
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

_(Snapshot finalized at /sdd-spec time — re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias, evaluator parity between backtest and live |
| `xstockstrat-indicators` (service owner) | Formula sandboxing, numeric precision, timeout enforcement, no side-effects from formula execution (formula components) |
| `xstockstrat-ingest` (service owner) | Signal normalization, newsletter source schema stability (signal-weighting inputs) |
| `xstockstrat-agent` (service owner) | MCP management-tool correctness, admin-scope enforcement, `x-mcp-secret` propagation _(note: agent not yet in reviewer-registry Service Owners table — registry gap)_ |
| Proto Reviewer | Field number uniqueness, additive/non-breaking changes for new strategy messages and RPCs |
| DBA | New `analysis.strategies` migration: NNN numbering, up+down pair, index/partition correctness |
| Security | Admin API key scoping on mutating MCP tools, `secret.*` handling for any credential refs |

## Next Action

`/sdd-review strategy-engine impl-spec` — validate implementation spec, then `/sdd-execute strategy-engine`
