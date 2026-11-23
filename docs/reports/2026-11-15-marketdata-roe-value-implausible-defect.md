# Defect: Fundamentals ROE value implausible against sibling metrics (EDGAR quarterly ROE uses a comparative-column equity)

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

`roe` is a 0–1 fraction on every provider path and equals the symbol's own net income over its own
shareholders' equity. For LYFT (SEC companyfacts, CIK0001759509) the trailing-twelve-month net
income is 2,809,866,000 and the `Q3-2026` quarter-end equity is 2,980,873,000, so the expected
`roe` is `0.942632` (FY2025: 2,844,008,000 / 3,273,523,000 = `0.868791`).

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

Not a unit error. The EDGAR quarterly TTM path divides a genuine TTM net income (2,809,866,000) by a
first-seen comparative-column equity (767,016,000, dated 2024-12-31): 3.6634. Traced on the filing
in `docs/roadmap/features/340-fix-fundamentals-roe-unit/recon.md` § Root-Cause Trace and debate.md D-11.

## Confidence

high
