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
- xstockstrat-marketdata — bounded latest-quote read, quotes retention
- xstockstrat-config — SetConfig scalar bounds for the new keys
- xstockstrat-ui — surface only (`/trader/portfolio`); no change anticipated

## Fix Scope

- No proto changes anticipated.
- **DB migration:** a marketdata migration adds a TimescaleDB retention policy on `marketdata.quotes`. Operator chose
  this scope on 2026-10-16. It needs DBA + marketdata owner approval.
- **Config keys:** new keys for the portfolio enrichment deadline and the marketdata latest-quote recency window,
  read live with code defaults, SetConfig-bounded, and logged in `docs/patterns/config-governance.md`. Needs owner +
  config team approval.

## Acceptance Criteria

See `acceptance.feature`. The regression scenarios must fail on the buggy behavior and pass after the fix (Constitution
**C-15**). In addition, existing tests must pass, and Book → Portfolio and MCP `get_positions` must be smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Other unbounded marketdata reads (e.g. `GetPreviousDailyCloseBatch` over `ohlcv`), except where the design shows they
  share this root cause
- UI changes to the Portfolio page's loading/error states
