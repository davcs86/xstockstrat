# Feature: backtest-debug-info

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/backtest-debug-info`
**Created**: 2026-07-08
**Last Updated**: 2026-07-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings; OQ-3/OQ-5 resolved in-spec; overlap CLEAN) |
| 2026-07-08 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-debug-info`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Surface full day-by-day backtest diagnostics — per-bar OHLCV, computed indicator series, warm-up
markers, per-bar signal scores, and the entry/exit/conviction decision the engine made — so a
strategy author can see *why* a backtest produced 0 trades even when data coverage is sufficient.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, additive-only (no breaking changes without deprecation), `buf lint`/`buf breaking` pass — spans `analysis.proto` + `indicators.proto` |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** in the emitted per-bar diagnostics; Option-C warm-up length correctness |
| `xstockstrat-indicators` (service owner) | Formula `warmup_period` persistence/validation, no side-effects, numeric precision |
| `xstockstrat-ui` (service owner) | Analytics display accuracy, Connect-RPC call safety, no direct DB access, large-table render performance, formula-authoring input correctness |
| DBA | `004_formula_warmup` migration: NNN numbering, up+down pair, additive column default, run-order compliance |

## Next Action

`/sdd-spec backtest-debug-info` — generate the implementation spec from the approved design
