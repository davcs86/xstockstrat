# Feature: backtest-debug-info

**Committed to main**: 6fab9e323637aa00e0ad5fc09bb68a1ab6c5a529
**Launched date**: 2026-07-12
**Development Branch**: `feature/backtest-debug-info`
**Created**: 2026-07-08
**Last Updated**: 2026-07-09
**Archived**: 2026-08-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (0 warnings; OQ-3/OQ-5 resolved in-spec; overlap CLEAN) |
| 2026-07-08 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-07-09 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 17 steps |
| 2026-07-09 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started (Steps 1–2: proto + codegen) |
| 2026-07-09 | `in-progress` → `code-completed` | /sdd-execute | All 17 steps done + verified (8 stacked PRs #746–753); integration PR opened |

| 2026-07-12 | `code-completed` → `launched` | CI workflow | Promoted via PR #759; committed 6fab9e323637aa00e0ad5fc09bb68a1ab6c5a529 |
| 2026-08-06 | `launched` (unchanged) | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(1)/fails(1); pruned 4 specs (product-spec.md, recon.md, design.md, implementation-spec.md) |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map (Phase 0)
- [Design](design.md) — debated, approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Surface full day-by-day backtest diagnostics — per-bar OHLCV, computed indicator series, warm-up
markers, per-bar signal scores, and the entry/exit/conviction decision the engine made — so a
strategy author can see *why* a backtest produced 0 trades even when data coverage is sufficient.

## Reviewers

_(Snapshot finalized at /sdd-spec time from the distinct step Reviewers across
implementation-spec.md. Stable unless /sdd-spec re-runs.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness per message, additive-only (no breaking changes without deprecation), `buf lint`/`buf breaking` pass — spans `analysis.proto` + `indicators.proto` (Steps 1–2) |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** in the emitted per-bar diagnostics; Option-C warm-up length correctness; reject-not-clamp range cap; agent RunBacktest contract (Steps 1, 6–13, 16–17) |
| `xstockstrat-indicators` (service owner) | Formula `warmup_period` persistence/validation, no side-effects, numeric precision (Steps 1, 3–5) |
| `xstockstrat-ui` (service owner) | Analytics display accuracy, Connect-RPC call safety, no direct DB access, large-table render performance, formula-authoring input correctness (Steps 14–15) |
| DBA | `004_formula_warmup` migration: NNN numbering, up+down pair, additive column default, run-order compliance (Step 3) |

## Next Action

Merge the integration PR (`feature/backtest-debug-info` → `main-dev`); CI validates on merge. Then `/promote` to production once validated on dev.
