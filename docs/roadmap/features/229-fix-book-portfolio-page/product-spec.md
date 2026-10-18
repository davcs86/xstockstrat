# Product Spec: fix-book-portfolio-page

**Type**: bug
**GitHub Issue**: none (Issues disabled) — `docs/reports/2026-10-16-portfolio-page-stuck-loading-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-16

---

## Problem Statement

**Observed.** On staging, `/trader/portfolio` shows "Loading portfolio…" indefinitely while every component reports
HEALTHY. On 2026-10-16:
- The MCP `get_positions` tool (portfolio `ListPositions`) times out at 60s.
- The MCP `query_bars` tool (marketdata `GetBars`) also times out at 60s.
- Positions for a broker-valued Alpaca account return instantly, because that path skips quote enrichment.

**Expected.**
- The page loads within a bounded time even when marketdata is slow. Positions that cannot be enriched in time are
  returned unenriched (the existing missing-quote outcome) and never get a fabricated price.
- Marketdata's latest-quote read costs a bounded amount, not one proportional to the full history of
  `marketdata.quotes`.

## Reproduction Steps

1. On staging, open `/trader/portfolio` as a user with offline (Schwab/Webull) accounts whose positions have no broker
   valuation.
2. "Loading portfolio…" never resolves. Alternatively, MCP `get_positions` times out at 60s.

## Root Cause Hypothesis

Two defects combine:
1. **Unbounded quote query (marketdata).** `GetLatestQuotesBatch` runs
   `SELECT DISTINCT ON (symbol) … FROM marketdata.quotes WHERE symbol = ANY($1) ORDER BY symbol, time DESC` with no time
   predicate. Every call therefore plans, locks and scans every 1-hour chunk of a hypertable that is never pruned
   (`marketdata.retention.quotes_days` is documented but not implemented), and the warm poller grows it every 30s.
   Marketdata's 2-connection pool starves. Staging logs show prev-close reads hitting their deadline and per-symbol
   work slowed from milliseconds to minutes.
2. **No deadline (portfolio).** `latestQuotesFor` calls `GetLatestQuotes` on the inbound request context, and no hop
   (browser BFF → portfolio → marketdata) sets a deadline. The UI query neither resolves nor errors.

A contributing factor: the `GetLatestQuotes` singleflight closure runs on the first caller's context (the shape feature
227 fixed for `BatchGetLatestPrice`).

## Affected Services

- xstockstrat-portfolio — enrichment deadline
- xstockstrat-marketdata — bounded latest-quote read, detached cold-fetch budget, quote retention job
- xstockstrat-config — SetConfig scalar bounds for the new keys
- xstockstrat-ui — surface only (`/trader/portfolio`); no change anticipated

## Fix Scope

1. **Portfolio enrichment deadline.** `latestQuotesFor` (`portfolio_service.go`) calls `GetLatestQuotes` under a deadline.
   On timeout it takes the existing missing-quote path: it logs a WARN and returns an empty map, so positions stay
   unenriched and no price is fabricated. Because `latestQuotesFor` is the single choke point, the deadline bounds
   every caller: `enrichPositions`, the `ListPortfolios`/`ListPositions`/`GetPortfolio`/`GetPosition` reads, and the
   risk-check/snapshot callers. This preserves C-10(b) parity.
2. **Bounded batch quote read.** `GetLatestQuotesBatch` gains a recency predicate (`time > now() - window`) so
   TimescaleDB excludes chunks outside the window. A symbol with no row inside the window is cold and goes to the
   existing live-fetch path.
3. **Detached singleflight budget.** The `GetLatestQuotes` cold-fetch closure runs on a context detached from the
   first caller and bounded by a budget (the 227 `BatchGetLatestPrice` pattern). A cancelled first caller then no
   longer fails coalesced waiters.
4. **Quote retention job.** A marketdata background loop periodically runs
   `drop_chunks('marketdata.quotes', older_than => <N> days)`, with N read live from `marketdata.retention.quotes_days`.
   - The mechanism is Apache-licensed, which works around the TSL `add_retention_policy` unavailable on DO (backlog
     feature 040).
   - It supersedes feature 040's `marketdata.quotes` row; the operator approved this on 2026-10-16.
   - Dropped quote history is intentionally not rolled up into bars. `marketdata.ohlcv` already holds the authoritative,
     adjusted Alpaca trade bars for the same warm-symbol set.

5. **Cache-age guard** (added in design round 2). Marketdata never caches a quote older than the recency window or
   with a zero timestamp. The quote is still returned to the caller. Without this, halted symbols would keep recreating
   dropped chunks.
6. **Partial result on cold failure** (added in design round 3). `GetLatestQuotes` returns the warm subset and omits
   cold symbols it failed to fetch, never zero-priced. This reverses feature 178's all-or-nothing waiver.
7. **GetPnL** (added in design rounds 2-3, with operator sign-off):
   - It returns `UNAVAILABLE` instead of a silent 0 when a needed quote is unavailable, whether the fetch failed or
     the symbol was omitted.
   - It values broker-synced positions from the broker `current_price`, through the shared valuation helper.
8. **Snapshot guard** (added in design round 4). `broadcastSnapshot` skips persisting when quotes are unavailable or no
   position was priced, so it never writes a zero-equity snapshot.

The design is in `design.md`.

**Proto:** none. GetPnL's failure status code changes from Internal to Unavailable; the schema does not change.

**DB migration:** none. Retention is an application job, not a migration, so the C-07 migration gate and the DBA
approval do not apply. Dropping chunks is irreversible by nature.

**Config keys** (live per-call read, code default, SetConfig-bounded in `SCALAR_BOUNDS_REGISTRY`, logged in
`docs/patterns/config-governance.md`; owner + config-team approval):

| Key | Type | Default | Bounds | Notes |
|---|---|---|---|---|
| `portfolio.marketdata.quote_timeout_ms` | int | `4000` | `[500, 8000]` | New. Deadline on portfolio → marketdata `GetLatestQuotes`. Must exceed the marketdata cold budget + warm read so a cold timeout still returns the warm subset (design rounds 1, 4). |
| `marketdata.quotes.latest_lookback_hours` | int | `168` | `[24, 720]` | New. Recency window of the cached batch read; 7 days covers 3-day weekends and holidays. |
| `marketdata.quotes.batch_timeout_ms` | int | `2500` | `[500, 5000]` | New. Budget of the detached cold-fetch singleflight closure. |
| `marketdata.retention.quotes_days` | int | `90` | `[31, 3650]` | Existing documented key, now implemented. The 31-day floor keeps retention longer than the maximum 720h (30-day) lookback window. |

## Consumer Surface(s)

- `/trader/portfolio` (Book → Portfolio). No UI change; it loads because the backend now answers within a bound.
- MCP `get_positions` / `get_positions_by_account_id`. No contract change; they stop timing out.

## Acceptance Criteria

See `acceptance.feature`. The regression scenarios must fail on the buggy behavior and pass after the fix (Constitution
**C-15**). In addition, existing tests must pass, and Book → Portfolio and MCP `get_positions` must be smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Other unbounded marketdata reads (e.g. `GetPreviousDailyCloseBatch` over `ohlcv`), except where the design shows they
  share this root cause
- UI changes to the Portfolio page's loading/error states
