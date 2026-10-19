# Recon: fix-after-hours-positions-priced

**Created**: 2026-10-19
**From**: product-spec.md (+ sdd-review warnings W1–W8, context.md)
**Affected services**: xstockstrat-portfolio, xstockstrat-marketdata (xstockstrat-trading read for the reuse pattern only)

---

## Objective

After the 16:00 ET close an IEX quote becomes one-sided (ask or bid ≤ 0). Every portfolio and marketdata consumer
averages `(ask + bid) / 2`, which halves quote-priced positions, persisted equity snapshots, the concentration
risk valuation and the EDGAR fundamentals live-price overlay. The fix must price from a usable value or leave the
position unpriced, and never fabricate one.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Quote fetch: `latestQuotesFor(ctx, symbols) (map, bool)` — `internal/service/portfolio_service.go:392`.
    It makes one `GetLatestQuotes` call under `quoteTimeout()` (`:411-420`, `portfolio.marketdata.quote_timeout_ms`,
    default 4000). `ok=false` only on an RPC error or timeout.
  - `unvaluedSymbols` — `:424`. Returns symbols with `CurrentPrice <= 0`.
  - `enrichPositions` — `:440-444`. Used by GetPortfolio `:577`, GetPosition `:607` and ListPositions `:628`.
  - `applyQuotes` — `:448-464`. Skips broker-valued positions (`CurrentPrice > 0`, `:450`) and missing quotes
    (`:454`). Mid at `:457`; the only guard is `price <= 0` (`:458`). Then calls `enrichPosition` (`:462`).
  - `enrichPosition(p, ask, bid)` — `:547-555`. Recomputes the mid (`:548`), then sets CurrentPrice, MarketValue,
    UnrealizedPnl and UnrealizedPnlPct. The mid formula is therefore written twice.
  - GetPnL — `:641-659`:
    - `applyQuotes` at `:652`;
    - `CurrentPrice <= 0` → `ErrQuotesUnavailable` (`:637`, `:655-656`), mapped to UNAVAILABLE by
      `classifyGetPnLError` (`internal/handler/portfolio_handler.go:426`).
  - ListPortfolios — `:1338-1343`. One `latestQuotesFor(unvaluedSymbols(all))`, then `applyQuotes` per account, then
    `buildAccountPortfolio`.
  - `broadcastSnapshot` — `:827-871`:
    - quotes **all** symbols, including broker-valued ones (`:833-837`);
    - mid at `:841` with no guard;
    - skip rule at `:847` (`!ok || priced == 0`);
    - then `InsertSnapshot` (`:858`), event `portfolio.snapshot` (`:859`) and subscriber fan-out (`:864`).
  - `checkRiskLimits` — `:891-931`:
    - quotes all symbols (`:901-905`);
    - mid at `:908` with no guard;
    - `posValues`/`totalValue` → concentration `pct > portfolio.risk.concentration_limit_pct` (default 0.20, `:893`);
    - → `emitRiskAlert` (`:919-920`, `:933-947`: ledger event plus notify WARNING, category `risk`).
    - Drawdown uses broker `account_balances` equity (`evaluateDrawdowns`, `:875`, `:925-929`), not quotes.
  - Marketdata client: field `marketdata marketdatav1.MarketDataServiceClient` (`:42`, built at `:145`). The only RPC
    used is `GetLatestQuotes` (`:399`). Header propagation comes from `middleware.UnaryClientInterceptor` (`:127`,
    `internal/middleware/propagation.go:39-45`).
  - Config: `intConfig` interface `:1432`, `quoteCfg` `:49` (set `:154-156`), `Watcher.GetInt` `internal/config/config.go:126`.
  - Last migration: `016_account_balance_peak_equity.up.sql`. No migration is expected.
- **`xstockstrat-marketdata`** (Go)
  - `livePrice` — `internal/service/marketdata_service.go:1735-1745`:
    - mid at `:1740`, guarded only by `mid <= 0`;
    - goes through cache-first `GetLatestQuotes`.
  - EDGAR snapshot:
    - gate `snapshotSource()` `:1655` (`marketdata.fundamentals.snapshot_source`, default `vendor`; edgar dispatch `:1487`, `:1506`);
    - kill switch `:1698`;
    - edgar-axis cache hit `:1705-1707` (24h TTL);
    - live join `:1726`, then `UpsertFundamentals` `:1727`;
    - `edgarSnapshotFromPeriod` `:1752-1756` falls back to the filed-date close `p.Price` when live is nil.
  - Quote producers, none of which filters one-sided quotes:
    - alpaca `GetLatestQuote` `internal/alpaca/client.go:289-320`;
    - alpaca `GetLatestQuotesMulti` `client.go:473-510`;
    - WS `stream.go:255-263`;
    - `cacheQuote` `marketdata_service.go:974-979` (nil, no-time and out-of-window guards only);
    - warm poller `:1005-1074`.
  - Last-trade path: `GetLatestPrice` `:625-649` (live every call, no budget). `BatchGetLatestPrice` `:767-887`:
    - singleflight on `batch-price:<sorted>`, detached context;
    - `resolveBatchPriceBudget` `:901-903` (`marketdata.price.batch_timeout_ms`, default 2500);
    - fetches trades live; omits a symbol with no trade and no prev-close (`:873`);
    - no cross-call cache.
    - Source interfaces: `internal/source/source.go:25` (`MultiSymbolSource`), `:32` (`Trade`), `:39` (`LatestTradeSource`).
- **`xstockstrat-trading`** (Go, reference only): `ComputePositionSize` has an inline one-sided switch at
  `internal/service/trading.go:3156-3169`:
  - both sides > 0 → mid;
  - ask > 0 → ask;
  - bid > 0 → bid;
  - otherwise `FailedPrecondition`.
- **Proto** (`packages/proto/marketdata/v1/marketdata.proto`):
  - `Quote` `:91-98`: symbol=1, time=2, ask_price=3, ask_size=4, bid_price=5, bid_size=6, source=7.
  - `LatestPrice` `:106-111`: symbol=1, `optional double last_price=2`, last_trade_time=3, `optional double prev_close=4`, source=5.
  - RPCs: `GetLatestPrice` `:26`, `BatchGetLatestPrice` `:54` (`:341-347`).
- **Shared Go code**: `go.work` lists `packages/proto`, marketdata, portfolio and trading. The only shared module is
  `github.com/xstockstrat/contracts` (`packages/proto`): generated stubs plus one hand-written carve-out,
  `packages/proto/pnl/pnl.go` (realized-P&L scope; corrected in design round 2).

## Patterns to REUSE

- **One-sided quote → usable price.** Reuse the rule from `trading.go:3156-3169` (mid if both > 0, else the positive
  side, else no price). Do **not** invent a different rule.
  - Where it lives is a design fork: duplicate it per service (portfolio, marketdata), or create a first
    hand-written shared package. No such package exists today (Not found).
- **Single price helper per service.** `applyQuotes` and `enrichPosition` must share one function. This keeps the
  feature 178 batched-equals-single parity (`portfolio_service_test.go:46-75`, PR #735 guard, `fails.md:38-40`).
- **"Unpriced" signal.** Keep `CurrentPrice` 0 as "unpriced" (feature 229 AC-1) and keep the `ErrQuotesUnavailable`
  → UNAVAILABLE mapping (`:637`, `portfolio_handler.go:426`) for GetPnL.
- **Batched last-trade fallback, if chosen.** Use the existing `BatchGetLatestPrice` (singleflight, detached budget,
  omits rather than fabricates). It needs no proto change. Portfolio's existing client already propagates headers.
- **Snapshot skip.** Reuse the existing `priced == 0` skip (`:847`) instead of a new guard.
- **Test harness:**
  - portfolio: `stubMarketData` (`portfolio_service_test.go:18-26`; it panics on non-overridden methods, so
    `BatchGetLatestPrice` would need an override), `newQuoteSvc`/`posRow`/`quote(sym, mid)` (`portfolio_quote_deadline_test.go:78-87`),
    `fakeConfig` (`watchlist_service_test.go:244`);
  - marketdata: `edgarSnapshotSvc` (`marketdata_service_test.go:2297`), `fakeMultiSource` (`:991-1034`), and the
    batch-price fakes (`:1344`, `:1410`).
  - No `internal/testdata/` fixture home exists in portfolio (C-13: quote literals are inline today).

## Existing Business Rules (preserve / extend)

- **EXTEND** `@AC-1 @regression @feature-229` "Portfolio reads return unenriched positions when the quote fetch exceeds its deadline" (`services/xstockstrat-portfolio/acceptance/fix-book-portfolio-page.feature`) — add the one-sided-quote case to the same unpriced outcome (`current_price` 0, no fabricated value).
- **PRESERVE** `@AC-5 @regression @feature-229` "GetPnL refuses to report unrealized P&L when a needed quote is unavailable" (same file) — a design decision is needed on whether a one-sided quote with no fallback counts as unavailable. If it does, GetPnL returns UNAVAILABLE after hours for offline holders.
- **PRESERVE** `@AC-6 @regression @feature-229` "GetPnL values broker-synced positions from the broker price without a quote fetch" (same file).
- **PRESERVE** `@AC-1 @FR-1 @FR-4 @feature-178` "Position enrichment uses one batched quote call" (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`) — one rule for batched and single; any fallback must be one batched call.
- **EXTEND** `@AC-4 @FR-4 @feature-178` "A symbol with no quote maps to the same missing outcome under batching" (same file) — one-sided becomes another "missing" case. Read `current_price` 0 as "not priced", which satisfies 178's "not silently assigned a zero price".
- **PRESERVE** `@AC-7 @FR-6 @feature-157` (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — ListPositions ↔ ListPortfolios valuation parity.
- **PRESERVE** `@AC-12 @FR-6 @feature-157` (same file) — short unrealized P&L; an unpriced short must not fabricate P&L.
- **PRESERVE** `@AC-14 @FR-6 @feature-157` (same file) — broker-account P&L is unaffected.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-172` (`services/xstockstrat-portfolio/acceptance/drawdown-enforcement.feature`) — drawdown stays on broker equity; the `:908` fix must not move it.
- **PRESERVE** `@AC-2`, `@AC-3`, `@AC-7`, `@AC-8 @regression @feature-229` (`services/xstockstrat-marketdata/acceptance/fix-book-portfolio-page.feature`) — windowed cache read, detached coalescing, out-of-window-not-cached, warm-subset-on-cold-failure. Filtering one-sided quotes inside `GetLatestQuotes` would widen `@AC-8` for every consumer.
- **PRESERVE** `@AC-3 @FR-3 @feature-178` (`services/xstockstrat-marketdata/acceptance/quote-fanout-batching.feature`) — cold requests coalesce to one fetch.
- **EXTEND** `@AC-6 @FR-5 @FR-8 @feature-211` (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`) — the snapshot is still served when the live quote is one-sided, priced from the usable side or the filed-date close, never halved and never an error.
- **PRESERVE** `@AC-9 @feature-211` (same file) — backtest vs live snapshot composites stay in the same band. The fix restores this.
- **PRESERVE** `@AC-7 @FR-7 @feature-215` (`services/xstockstrat-marketdata/acceptance/block-fundamentals-strategy-on-etf.feature`) — fundamentals status codes stay unchanged.
- **PRESERVE** `@AC-4`, `@AC-5 @FR-3 @feature-191` (`services/xstockstrat-marketdata/acceptance/opportunities-latency-fix.feature`) and `@AC-3 @regression @feature-227` (`fix-opportunities-read-hangs.feature`) — the `BatchGetLatestPrice` contract (batched, omits, logs fallback errors), if it is reused.
- **PRESERVE** `@AC-2 @feature-110` (trading) and platform `@AC-3 @feature-110` — only relevant if trading's sizing rule moves into a shared helper.
- **Coverage gaps (new ground):** no existing @AC covers the persisted equity snapshot, the concentration valuation, or ListPortfolios offline equity pricing.

## Dependencies

- Proto/RPC: none required. Optional reuse of `BatchGetLatestPrice` (`marketdata.proto:54`, `LatestPrice.last_price=2`)
  for a last-trade fallback; this is additive client usage with no schema change.
- Migration: none.
- Config keys: none new. Existing ones are reused (`portfolio.marketdata.quote_timeout_ms`,
  `marketdata.price.batch_timeout_ms`, `portfolio.risk.concentration_limit_pct`).
- Inter-service edges: portfolio → marketdata `GetLatestQuotes` (existing). A last-trade fallback would add
  portfolio → marketdata `BatchGetLatestPrice`, a new edge on the existing client.
- New env vars / ports: none.

## Risks / Not-found

- **Not found:**
  - No shared hand-written Go package across services.
  - No `quotePrice`/`midPrice`-style helper anywhere.
  - No one-sided filter in any producer, cache or poller.
  - No stored last-trade price.
  - No portfolio `internal/testdata/` fixture home.
  - No direct unit test of `livePrice` / `edgarSnapshotFromPeriod`.
- **The raw after-hours quote was not inspected.** Which side goes to 0, or whether the remaining side is a stale or
  wide quote, is inferred from the ~0.45–0.5 ratio. For example, ICE 70.725 × 2 = 141.45 against 158.85, so the
  surviving side can sit about 11% off the last trade. **Risk:** the "use the positive side" rule (trading's)
  may still misprice by about 10% after hours.
- **Poisoned EDGAR cache:** halved snapshot prices already written stay served for up to 24h (`:1705-1707`). The
  fix does not purge them; they age out by TTL.
- **Snapshot and risk re-price broker-valued positions from quotes** (`:833-837`, `:901-905`), unlike
  `applyQuotes`. This is a pre-existing asymmetry with the broker-authoritative rule (`fails.md:38-40` parity trap).
- **GetPnL after hours:** if one-sided means unpriced with no fallback, GetPnL returns UNAVAILABLE every evening for
  offline holders. That is consistent with 229 AC-5, but it is a real UX consequence.
- **Marketdata-side filtering** (dropping or not caching one-sided quotes) changes `GetLatestQuotes` for every
  consumer (trading sizing, which handles one-sided quotes correctly today, and the agent), and widens 229 `@AC-8`.
- **Overlap:** `230-offline-account-full-pnl` (`ccr-cd56ff4d-s5wkbb`, draft) will touch the same valuation
  functions. Whichever lands second reconciles.
- **Test constraint:** `portfolio_service_test.go:46-75,92` assert the exact `(Ask+Bid)/2` mid. Update them
  deliberately with symmetric two-sided quotes; the mid stays correct for those.

## Recommended Scope

1. Portfolio: one per-service price function (the trading rule) used by `applyQuotes`/`enrichPosition`,
   `broadcastSnapshot` and `checkRiskLimits`. Unpriced quotes flow to the existing unpriced paths.
2. Marketdata: `livePrice` uses the same rule. A nil result falls back to the filed-date close (existing).
3. Optional (design fork): last-trade fallback via `BatchGetLatestPrice` for symbols still unpriced.
4. Optional (design fork): snapshot/risk keep broker `CurrentPrice` instead of re-pricing broker-valued positions.
5. Tests + acceptance rewrite (W1–W6), docs.
