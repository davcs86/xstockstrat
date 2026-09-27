# Feature: sector-classification-strategy-params

**Development Branch**: `feature/sector-classification-strategy-params`
**Created**: 2026-09-27
**Last Updated**: 2026-09-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-27 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
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

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, no breaking changes without deprecation, `buf lint`/`buf breaking` pass, `Sector` enum `_UNSPECIFIED=0` sentinel |
| DBA | Migration NNN numbering, up+down pair, SCD `valid_from`/`valid_to` index + partial-unique-on-open-row correctness, hypertable strategy for the classification history |
| `xstockstrat-marketdata` (owner) | Alpaca/FMP feed idempotency, centralized FMP rate-limit gateway correctness, SCD diff-and-version-on-change integrity, refresh never blocks reads |
| `xstockstrat-analysis` (owner) | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** in the as-of-bar sector join |
| `xstockstrat-indicators` (owner) | Formula param injection, numeric precision, no side-effects from per-sector param resolution |
| `xstockstrat-agent` (owner) | `manage_strategy` tool contract stability + descriptor-parity projection when the strategy message gains a per-sector param map |
| Security | FMP credential resolved via `GetSecret` (feature 147), never re-introduced as an env var; no secret in tool/UI output |

## Next Action

`/sdd-review sector-classification-strategy-params product-spec` — AI review of product spec before running /sdd-spec
