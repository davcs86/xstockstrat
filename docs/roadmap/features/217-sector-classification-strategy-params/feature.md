# Feature: sector-classification-strategy-params

**Development Branch**: `feature/sector-classification-strategy-params`
**Created**: 2026-09-27
**Last Updated**: 2026-09-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-27 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings, all deferred to design/spec) |
| 2026-09-27 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, deep) and approved; recon.md + design.md written |
| 2026-09-27 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 18 steps |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, reuse patterns, C-16 existing business rules
- [Design](design.md) — debated architecture (4 rounds), rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
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

`/sdd-review sector-classification-strategy-params impl-spec` — validate implementation spec, then `/sdd-execute sector-classification-strategy-params`
