# Defect: Fundamentals ROE value implausible against sibling metrics (suspected percent-vs-fraction unit error)

**Recorded**: 2026-11-15
**Severity**: SEV-3
**Impact type**: wrong-fundamentals-displayed
**Environment**: staging (homelab, main-dev)
**Affected service(s)**: xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

The symbol page Fundamentals card for LYFT shows `ROE +366.34%` alongside market cap
`$6,726,553,623.93`, `P/B 8.77`, `EPS 0.11`. The UI multiplies the backend value by 100, so the
backend served `roe ≈ 3.6634`.

## Expected

`roe` is a 0–1 fraction on every provider path, consistent with the sibling metrics. Market cap /
P/B implies book equity of roughly $767M; an ROE of 3.66 would imply net income near $2.8B, while
EPS 0.11 implies net income in the tens of millions — an ROE in the low single-digit percent.

## Reproduction

1. Staging, trader segment, symbol page for LYFT, Research tab.
2. Read the Fundamentals card (or `GetFundamentals` for LYFT) and compare `roe` with `market_cap`,
   `pb_ratio`, `eps`.

## Evidence

`services/xstockstrat-ui/src/lib/money.ts:18-23`
> /** Signed percentage from a 0–1 ratio (`+2.57%`) */ ... const pct = Number(n) * 100;

`services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go:260`
> f.ROE = scale100(m.ROETTM) // percentage-points -> fraction (matches FMP)

`packages/proto/marketdata/v1/marketdata.proto:233`
> double roe = 8;   (no unit comment)

## Root cause hypothesis

unknown — suspected: one provider/merge path stores ROE in percentage points without the
`scale100` conversion (a value of 3.66 percent served as the fraction 3.66). Derived from
arithmetic on the displayed values; the producing path is not traced.

## Confidence

low
