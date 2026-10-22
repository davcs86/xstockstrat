# Defect: After-hours positions priced at ~half value — quote mid computed from a one-sided quote

**Recorded**: 2026-10-19
**Reporter**: davcs86@gmail.com (via Claude Code)
**Severity**: SEV-2
**Impact type**: wrong-positions-displayed (also wrong persisted equity snapshots and wrong risk/concentration valuation)
**Environment**: staging (`xstockstrat-staging`, deployment `1f7df842`, image `cd1654c`); production runs the same code path
**Affected service(s)**: xstockstrat-portfolio, xstockstrat-marketdata
**Config-only fix possible**: no

## Observed

After the 16:00 ET close (~20:00 UTC on 2026-10-19), MCP `get_positions` priced quote-enriched positions
(offline accounts) at roughly 45–50% of their market value, while names with two-sided quotes stayed correct:

| Symbol | Before close (≤19:56 UTC) | After close (~20:10 UTC) |
|---|---|---|
| MSFT | 534.575 | 250.705 |
| AMD | 542.645 | 256.825 |
| UBER | 70.345 | 33.11 |
| PLTR | 194.305 | 92.575 |
| LYFT (offline, quote-priced) | 17.055 | 8.025 |

At the same moment, the Alpaca broker-synced LYFT position reported `current_price` 16.98. AAPL, NVDA, TSLA,
LLY and MSTR stayed correct. Unrealized P&L flips sign as a result (MSFT 9.234 sh: +1261.59 → −1359.67).

## Expected

A position whose quote is one-sided (one of ask or bid is 0) is never valued at `(ask + bid) / 2`. It is
valued from a usable price, or left unenriched (`current_price` 0) under the existing "no fabricated value"
contract (feature 229 AC-1). The same rule applies to equity snapshots, risk valuation and the fundamentals
price overlay.

## Reproduction

1. Hold a position in an offline account (no broker price) in a symbol whose IEX quote goes one-sided after the close.
2. After 16:00 ET, call MCP `get_positions` (or open Book → Portfolio).
3. The position's `current_price` is about half the last trade. Compare it with a broker-synced position in the same symbol.

## Evidence

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:457` (positions; guard rejects only `price <= 0`)
> price := (quote.AskPrice + quote.BidPrice) / 2

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:841` (persisted equity snapshot; no guard)
> price := (quote.AskPrice + quote.BidPrice) / 2

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:908` (risk/concentration valuation; no guard)
> price := (quote.AskPrice + quote.BidPrice) / 2

`services/xstockstrat-portfolio/internal/service/portfolio_service.go:548` (`enrichPosition`)
> price := (askPrice + bidPrice) / 2

`services/xstockstrat-marketdata/internal/service/marketdata_service.go:1740` (`livePrice`, fundamentals snapshot overlay)
> mid := (quotes[0].AskPrice + quotes[0].BidPrice) / 2

Introduced no later than 2026-09-02 (`6d06894`). This is not a regression from feature 229.

## Root cause hypothesis

After the close, the IEX feed's latest quote is one-sided (one side 0). The warm poller caches it every 30s,
and every consumer averages the two sides, which halves the price. The raw cached quote was not inspected
(no DB access from this session). The one-sided inference rests on the ~0.5 ratio and on the broker-price contrast.

## Confidence

high
