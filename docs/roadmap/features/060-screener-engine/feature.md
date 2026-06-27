# Feature: screener-engine

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/screener-engine`
**Created**: 2026-06-26
**Last Updated**: 2026-06-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-26 | `idea` → `draft` | /sdd-story | Product spec generated (feature 3 of 6 in the screener initiative) |
| 2026-06-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings fixed: Comparator marked new additive enum w/ zero sentinel; evaluator.py → sandbox.py/execute_formula) |
| 2026-06-27 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — 9 numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add an on-demand `ScreenSymbols` RPC to `xstockstrat-analysis` that ranks a symbol universe against
formula-driven criteria (reusing the indicators sandbox via the existing evaluator pattern) blended
with the source-weighted signal mechanism and FMP fundamentals — **without modifying `RunBacktest`
behavior** — plus a screener page in the `xstockstrat-ui` insights segment.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Additive `ScreenSymbols` RPC + messages + `Comparator` enum, field-number uniqueness, no breaking change, `buf lint`/`buf breaking` pass |
| `xstockstrat-analysis` (service owner) | **No look-ahead bias**, **backtest reproducibility unchanged** (golden-pinned scoring extraction, FR-4/FR-8), scoring determinism, ranking correctness, backtest isolation |
| `xstockstrat-indicators` (service owner) | Sandbox unchanged (no new injected vars), `ExecuteFormula` reused exactly as backtest does, timeout/concurrency under large universes |
| `xstockstrat-marketdata` (service owner) | `GetFundamentals` consumption + quota-aware degradation (skipped when 059 absent) |
| `xstockstrat-config` (service owner) | New `analysis.screener.*` keys — naming, defaults declared in service CLAUDE.md |
| `xstockstrat-ui` (service owner) | Screener page + BFF call safety, header propagation, loading/error states, no secret values rendered, Playwright E2E |

## Next Action

`/sdd-review screener-engine impl-spec` — validate implementation spec, then `/sdd-execute screener-engine`
