# Feature: sector-classification-strategy-params

**Development Branch**: `feature/sector-classification-strategy-params`
**Created**: 2026-09-27
**Last Updated**: 2026-10-06
**Committed to main**: 595bd1d4effdc73153752d8dce5cee69d1a6f656
**Launched date**: 2026-10-08
**Archived**: 2026-10-14

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-27 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings, all deferred to design/spec) |
| 2026-09-27 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, deep) and approved; recon.md + design.md written |
| 2026-09-27 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 18 steps |
| 2026-10-06 | `implementation-ready` (scope extended) | operator | Added @AC-14 (overrides reach fundamentals-input formulas); impl-spec needs re-spec — see context.md |
| 2026-10-06 | `implementation-ready` → `in-progress` → `code-completed` | /sdd-execute sequential | All 18 steps executed on `feature/sector-classification-strategy-params`; re-spec folded into the Deviation Log; integration PR opened |

| 2026-10-08 | `code-completed` → `launched` | CI workflow | Promoted via PR #1233; committed 595bd1d4effdc73153752d8dce5cee69d1a6f656 |
| 2026-10-14 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(2)/fails(2); pruned 4 spec(s) |
---

## Artifacts

- Product Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15); promoted to services/xstockstrat-{marketdata,analysis}/acceptance/ (sector-classification*.feature) and docs/sdd/business-rules/platform.feature (C-16)
- Recon Dossier — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Design — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- Implementation Spec — pruned by /sdd-archiver; see [Context Log](context.md) Archive Synthesis
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Introduce a point-in-time (Type-2 SCD) GICS-sector classification store in `xstockstrat-marketdata`,
sourced from a centralized rate-limited FMP gateway, and let a strategy carry per-sector formula
parameter overrides that `xstockstrat-analysis` resolves as-of each evaluated bar during scoring and
backtesting.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

Canonical snapshot — deduplicated from all step `**Reviewers**` values in `implementation-spec.md`
(Steps 1–18). Stable unless `/sdd-spec` re-runs.

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field number uniqueness, no breaking change without deprecation, `buf lint`/`buf breaking` pass against dev trunk, `Sector` enum `_UNSPECIFIED=0` sentinel, enum-over-string | 1, 2 |
| `packages/proto` (owner) | Field number uniqueness per message, naming conventions | 1, 2 |
| DBA | Migration NNN numbering (007, no gap), up+down pair, SCD `valid_from`/`valid_to` as-of index + partial-unique-on-open-row correctness (plain table — no hypertable, feature-153 lock guard) | 3 |
| `xstockstrat-marketdata` (owner) | Centralized single-throttle FMP gateway correctness (rps limiter + shared reserve/commit/refund UTC-day budget), SCD diff-and-version-on-change integrity, one-open-row invariant, refresh never blocks reads, RPC contract | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| Security | FMP credential resolved via `GetSecret` (feature 147), never re-introduced as `FMP_API_KEY` env var; no secret in tool/UI output | 4 |
| `xstockstrat-analysis` (owner) | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** in the as-of-bar sector join, no-override byte-parity, `ManageStrategy` field-15 validation + fingerprint fold | 1, 2, 11, 12 |
| `xstockstrat-agent` (owner) | `manage_strategy` tool contract stability + `docs/runbooks/mcp-tools.md` parity + six inventory surfaces in sync; `run_backtest` descriptor-parity (warnings reused, no new field) | 13, 14 |
| `xstockstrat-ui` (owner) | Analytics display accuracy, Connect-RPC call safety, C-17 tokens/primitives, exhaustive `Record<Sector,…>` fan-out compiles, no hardcoded colors | 15, 16 |

## Next Action

Merge the integration PR into `main-dev`; then flip `marketdata.classification.enabled=true` on staging and calibrate sector `de_bad`/`roe_bad` only after features 222/223 re-derive EDGAR periods.
