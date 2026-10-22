# Defect: Book → Portfolio page stuck on "Loading portfolio…"

**Recorded**: 2026-10-16
**Severity**: SEV-2
**Impact type**: read-path-unavailable
**Environment**: dev (main-dev, staging deployment `63d315a4`)
**Affected service(s)**: xstockstrat-portfolio, xstockstrat-marketdata (surface: xstockstrat-ui `/trader/portfolio`)
**Config-only fix possible**: no

## Observed

On staging, `/trader/portfolio` renders "Loading portfolio…" indefinitely and never shows balances or
positions (reported 2026-10-16 with a mobile screenshot). Every component reports HEALTHY.

Reproduced through the staging MCP agent on 2026-10-16:
- `get_positions` (portfolio `ListPositions`, all accounts) times out at the client's 60s limit.
- `get_positions_by_account_id` for the Alpaca account returns immediately. All its positions are
  broker-valued (`current_price > 0`), so it skips the marketdata quote enrichment.
- `query_bars AAPL` (marketdata `GetBars`) also times out at 60s. Marketdata itself is stalled.
- `list_accounts` (trading) answers promptly.

## Expected

The Portfolio page loads within a bounded time even when marketdata is slow:
- If live-quote enrichment cannot finish in time, positions are returned unenriched. Today the code
  already gives a missing quote this outcome (`enrichPositions` skips the position), and never
  fabricates a price.
- Marketdata's latest-quote read does not take time proportional to the full history of
  `marketdata.quotes`.

## Reproduction

1. On staging, open `/trader/portfolio` as a user with an offline account (Schwab/Webull) holding
   positions that have no broker valuation.
2. Observe "Loading portfolio…" never resolve. Alternatively, call the MCP `get_positions` tool and
   observe a 60s timeout.

## Evidence

Portfolio waits on marketdata with no deadline. The single choke point is
`services/xstockstrat-portfolio/internal/service/portfolio_service.go` `latestQuotesFor`, used by
`enrichPositions`, which the `ListPortfolios`, `ListPositions`, `GetPortfolio` and `GetPosition`
paths call:
> `resp, err := s.marketdata.GetLatestQuotes(ctx, &marketdatav1.GetLatestQuotesRequest{Symbols: symbols})`

`ctx` is the inbound request context, and the browser BFF sets no deadline either. The staging
portfolio log shows this call ending only when the caller gives up:
> `"msg":"batch latest quotes unavailable","count":41,"error":"rpc error: code = Canceled desc = context canceled"`
(2026-10-15T23:10, 23:14; 2026-10-16T22:14)

Marketdata's batch quote read scans the whole quotes hypertable:
`services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` `GetLatestQuotesBatch`:
> `SELECT DISTINCT ON (symbol) … FROM marketdata.quotes WHERE symbol = ANY($1) ORDER BY symbol, time DESC`

The cost of this query grows without bound:
- It has no time predicate, so TimescaleDB cannot exclude chunks. Every call plans, locks and scans
  every chunk.
- `marketdata.quotes` uses 1-hour chunks (migration `001`).
- The table is never pruned: `marketdata.retention.quotes_days` is "documented, not yet implemented".
- The warm poller inserts a row per warm symbol every 30s.

Since staging went live (2026-05-27) that is thousands of chunks per call. This is the same chunk-lock
failure mode feature 153 fixed for `marketdata.ohlcv` (`out of shared memory`, SQLSTATE 53200).

Marketdata's pool (2 conns) is starved as a result. Its staging log shows:
> `"msg":"BatchGetLatestPrice: previous-close lookup failed","symbols":34,"error":"prev daily close batch: context deadline exceeded"`
(2026-10-16T22:05)

Per-symbol fundamentals log lines that normally land ~7ms apart now land ~5 minutes apart
(22:24:20 → 22:29:47).

The `GetLatestQuotes` singleflight closure also runs on the first caller's context (the shape feature
227 fixed for `BatchGetLatestPrice`), so a cancelled first caller fails every coalesced waiter.

## Root cause hypothesis

Two defects combine into an indefinite hang:
- Marketdata's `GetLatestQuotesBatch` is unbounded in time. Its cost grows with the age of the quotes
  hypertable, which saturates marketdata's 2-connection pool.
- Portfolio's enrichment call has no deadline, so the stall reaches the UI. The UI's `isLoading` stays
  true because the request neither resolves nor errors.

## Confidence

high (unbounded query, missing deadline and the cancellation log are verified in code and staging
logs); medium (that the all-chunk scan, not other DB load, is the dominant saturation source — the
chunk count was not measured directly)
