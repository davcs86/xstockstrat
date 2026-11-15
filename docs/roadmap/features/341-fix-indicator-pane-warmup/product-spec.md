# Product Spec: fix-indicator-pane-warmup

**Type**: bug
**GitHub Issue**: n/a (Issues disabled) — report `docs/reports/2026-11-15-indicator-panel-sma200-single-point-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-15

---

## Problem Statement

Symbol page → Overview, indicator set `dip_buyer_vol_stop`, LYFT: the SMA200 pane shows a single
dot near 15.07 (the live `sma200` value is 15.07125). Expected: an indicator whose lookback is close
to or longer than the charted window renders across the window (computed with a warm-up prefix), or
the pane states that the indicator has insufficient history.

## Reproduction Steps

1. Staging, symbol page for LYFT → Overview.
2. Select the `Quality Dip Buyer + Volatility Stop` indicator set; observe the SMA200 pane.

## Root Cause Hypothesis

Under investigation — see context.md. The component series appears to be computed over only the
displayed window's bars. `src/lib/indicatorChart.ts:27-37` maps unset values to gaps and has no
warm-up handling; the analysis-side series builder is not traced.

## Affected Services

- `xstockstrat-ui`
- `xstockstrat-analysis` (candidate — series builder)

## Fix Scope

- [ ] No proto changes anticipated
- [ ] No database migrations anticipated
- [ ] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
