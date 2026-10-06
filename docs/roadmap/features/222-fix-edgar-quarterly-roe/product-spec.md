# Product Spec: fix-edgar-quarterly-roe

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-10-06-edgar-quarterly-roe-not-annualized-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-06

---

## Problem Statement

Observed: AXP historical EDGAR quarterly periods on staging carry `roe` 0.107 / 0.089 / 0.085 / 0.095
(Q2-2025 … Q2-2026) versus the FY2025 annual row's 0.339 — quarterly ROE is ~4× understated. On the
same quarterly rows P/E uses a trailing-twelve-month EPS (Q2-2026: 340.81 / 22.188 = 15.36 = sum of
the last four quarterly EPS), so a row mixes a TTM valuation ratio with a single-quarter return ratio.
The EDGAR snapshot is projected from the newest period and carries the same value. In the
`Fundamentals Value+Quality Composite (v1)` formula (`roe_good` 0.25, `roe_bad` 0.05) this moves
AXP's `fscore.composite` from ~0.589 to ~0.461, below the `fundamentals_macd_blend` entry gate (> 0.5).

Expected: quarterly ROE is on an annualized basis commensurable with annual rows and with vendor
`returnOnEquityTTM` — TTM net income over equity, falling back to a documented annualization when
fewer than four quarters are available.

## Reproduction Steps

1. Agent tool `query_fundamentals(symbol="AXP", mode="historical", range_start="2025-06-01")`.
2. Compare quarterly `roe` with the FY2025 annual `roe`, and with `price / pe_ratio` (TTM EPS).

## Root Cause Hypothesis

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:401-406` (`buildPeriod`) computes
`roe := ni / eq` from the period's own `net_income` regardless of `PeriodType`; P/E is derived on a
TTM basis elsewhere.

## Affected Services

xstockstrat-marketdata

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed.) Already-stored periods keep
the old value (earliest-filing idempotency pin), so the fix needs a re-derivation path for existing
rows — coordinate with `223-fix-stored-edgar-periods`, which needs the same purge + re-backfill.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Sector-specific scoring thresholds (delivered via feature 217 `@AC-14`)
- Retuning the fundamentals formula's `roe_good`/`roe_bad` params
