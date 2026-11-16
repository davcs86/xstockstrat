# Defect: Long-lookback indicator pane renders a single point (no warm-up prefix for the charted window)

**Recorded**: 2026-11-15
**Severity**: SEV-3
**Impact type**: ui-display-incorrect
**Environment**: staging (homelab, main-dev)
**Affected service(s)**: xstockstrat-ui, xstockstrat-analysis
**Config-only fix possible**: no

## Observed

Symbol page Overview tab, indicator set for `dip_buyer_vol_stop`, symbol LYFT: the third pane
(y-scale 15.05–15.10) shows one dot at the right edge near 15.07. That value matches the strategy's
`sma200` component (the live `px > sma200` condition threshold is 15.07125), so the SMA(200) series
has exactly one defined point across a charted window of roughly 190–200 daily bars (Feb–Nov).

## Expected

An indicator whose lookback is close to or longer than the charted window still renders a full
line across the window (values computed with a warm-up prefix), or the pane states that the
indicator has insufficient history.

## Reproduction

1. Staging, trader segment, symbol page for LYFT, Overview tab.
2. Select the `Quality Dip Buyer + Volatility Stop` indicator set.
3. Observe the SMA200 pane.

## Evidence

`services/xstockstrat-ui/src/lib/indicatorChart.ts:27-37`
> toLineData maps the shared time axis; an unset value becomes a whitespace point (gap).

Staging `ListOpportunities` (2026-11-15), LYFT / `dip_buyer_vol_stop`:
> { "ref_name": "px", "lhs_value": 16.975, "threshold": 15.07125, "fn": ">" }

## Root cause hypothesis

The component series is computed over only the bars of the displayed window, so a 200-period
average yields its first value on the last bar. UI code has no warm-up handling; the analysis-side
series builder is not traced.

## Confidence

low
