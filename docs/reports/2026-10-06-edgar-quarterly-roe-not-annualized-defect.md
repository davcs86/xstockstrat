# Defect: EDGAR quarterly ROE is a single-quarter ratio, not annualized, while P/E on the same row is TTM

**Recorded**: 2026-10-06
**Severity**: SEV-2
**Impact type**: wrong-signal-input
**Environment**: dev (staging)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

AXP historical EDGAR periods on staging: quarterly `roe` = 0.107 / 0.089 / 0.085 / 0.095
(Q2-2025 … Q2-2026) versus the FY2025 annual row's 0.339 — quarterly ROE is ~4× understated. On the
same quarterly rows P/E is computed on a trailing-twelve-month EPS (Q2-2026: 340.81 / 22.188 = 15.36
= 4.15 + 3.49 + 3.64 + 4.08), so the row mixes a TTM valuation ratio with a single-quarter return ratio.

The EDGAR snapshot (`snapshot_source=edgar`) is projected from the newest period, so the live
snapshot carries the same 0.095 ROE. In the `Fundamentals Value+Quality Composite (v1)` formula
(`roe_good` 0.25, `roe_bad` 0.05) this scores ROE 0.227 instead of 1.0, moving AXP's
`fscore.composite` from ~0.589 to ~0.461 — below the `fundamentals_macd_blend` entry gate
(`fscore.composite > 0.5`). It biases every quarterly-derived fscore, live and in PIT backtests.

## Expected

Quarterly ROE is reported on an annualized basis consistent with the row's other ratios — TTM net
income over (average or period-end) equity, or the quarter ×4 when four quarters are not available —
so quarterly and annual rows are commensurable and comparable to vendor `returnOnEquityTTM`
(`fmp_client.go:227`, `finnhub_client.go:222`).

## Reproduction

1. Agent tool `query_fundamentals(symbol="AXP", mode="historical", range_start="2025-06-01")`.
2. Compare quarterly `roe` with the FY2025 annual `roe`, and with `price / pe_ratio` (TTM EPS).

## Evidence

`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:401-406`
> roe := ni / eq

Staging AXP Q2-2026 row: `eps 4.08, roe 0.09532778218345228, pe_ratio 22.188151041666664, price 340.81`;
FY2025 row: `roe 0.33887742300999557`.

## Root cause hypothesis

`buildPeriod` divides the period's own `net_income` by equity regardless of `PeriodType`, so a
quarterly period yields a one-quarter ROE; P/E is derived elsewhere on a TTM basis.

## Confidence

high
