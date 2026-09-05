# Recon: quote-fanout-batching

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: xstockstrat-portfolio, xstockstrat-marketdata

---

## Objective

Collapse the N+1 fan-out on the portfolio→marketdata and portfolio→DB read edges: add an additive
`GetLatestQuotes` batch gRPC RPC to marketdata (wrapping the existing internal `MultiSymbolSource`
helper), switch portfolio's per-position `GetLatestQuote` loops to it, collapse `ListWatchlists`'
per-watchlist `listBindings` into one `ANY`-array query, and add single-flight to marketdata's
cold-symbol live fallback. Enriched values must stay field-for-field identical, including the
missing-quote (null-not-zero) outcome.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Proto: singular `GetLatestQuote` RPC `packages/proto/marketdata/v1/marketdata.proto:23`; `GetLatestQuoteRequest{symbol=1}` `:113`; `Quote{symbol=1,time=2,ask_price=3,ask_size=4,bid_price=5,bid_size=6,source=7}` `:63-71`. **Additive-batch precedent to MIRROR**: `GetFundamentalsMulti` RPC `:44`, `GetFundamentalsMultiRequest{repeated string symbols=1}` / `...Response{repeated Fundamentals=1}` `:221-227`. No batch-quote RPC exists.
  - Internal batch helper: `MultiSymbolSource.GetLatestQuotesMulti(ctx, symbols) (map[string]*Quote, error)` `internal/source/source.go:24-27`; Alpaca impl `internal/alpaca/client.go:362` — returns a map keyed **only** by symbols Alpaca returned (missing = absent, no error, no zero-fill) `:388-397`; empty input → empty map `:363`
  - Handler/adapter pattern to REUSE: Connect handler `GetLatestQuote` `internal/handler/marketdata_handler.go:96`; batch-handler precedent `GetFundamentalsMulti` `:183`; gRPC adapter struct `:209`, methods `:222`/`:318`; RPC registration `cmd/server/main.go:152`
  - Service methods: `GetLatestQuote` `internal/service/marketdata_service.go:406`; cold-symbol live fallback (singleflight target) `:410-427` (`src.GetLatestQuote` then `s.repo.InsertQuote` `:416-427`); interval rate-limiter fields `staleMu`/`lastStaleCheck` `:49-50` (NOT single-flight); warm-poller already uses the multi path `:517`
  - Dep: `golang.org/x/sync v0.20.0` present **indirect** `go.mod:36` (importing `singleflight` promotes to direct; `go mod tidy`, no new download)
  - Tests: service `internal/service/marketdata_service_test.go` (source-stub `fakeBackfillSource` `:696-724`); Alpaca `internal/alpaca/client_test.go:499` `TestGetLatestQuotesMulti_Success`; **no handler-layer test file** (RPCs unit-tested at service layer via `source.Registry` fakes)
- **`xstockstrat-portfolio`** (Go)
  - `marketdata` client field `internal/service/portfolio_service.go:42` (`marketdatav1.MarketDataServiceClient`); dial `:113`, construct `:127`
  - `enrichPositions` shared helper `:324`; per-position `GetLatestQuote` `:329`; **null-not-zero contract**: skip pre-valued (`CurrentPrice>0 continue` `:326`), on quote error `continue` w/o write `:330`, on unusable price `continue` `:335` — never fabricates 0. Call sites: `GetPortfolio:455`, `GetPosition:485`, `ListPositions:506`, `buildAccountPortfolio:1035`
  - Independent inline quote loops NOT via enrichPositions: `GetPnL:522-528` (quote `:523`), `broadcastSnapshot:692-698` (quote `:693`), `checkRiskLimits:731-737` (quote `:732`)
  - `ListWatchlists:1378` → `watchlists.ListByUser:1389` → 1+N `listBindings` loop `internal/repository/watchlist_repo.go:132-139`; `listBindings` `:395` (`SELECT symbol, strategy_id, source FROM portfolio.watchlist_symbols WHERE watchlist_id = $1 ORDER BY symbol`) — folds into `watchlist_id = ANY($1)`; PK `(watchlist_id, symbol)` `migrations/007_watchlists.up.sql:20` (`strategy_id` from `008`, `source` from `011`); last migration = 015
  - Tests: struct-literal servicer construction (`portfolio_risk_test.go:126`, `watchlist_service_test.go:271`); **no marketdata mock exists** — a stub must be newly authored for any batch-quote test

## Patterns to REUSE

- **New batch RPC** → mirror `GetFundamentalsMulti` end-to-end: proto (`marketdata.proto:44,221-227`), handler+adapter (`marketdata_handler.go:183,318`), service method; wrap the existing `alpaca.GetLatestQuotesMulti` `client.go:362` — **do not re-implement the fetch**.
- **Missing-quote null-not-zero** → the batch helper already returns a partial map (absent = missing); portfolio's `continue`-on-absent contract (`portfolio_service.go:326-337`) is preserved by looking up `quotes[symbol]` and treating absence exactly like the singular error path.
- **Single-flight** → add a `golang.org/x/sync/singleflight.Group` field on `MarketDataService` (`:30-66`), key by symbol, wrapping the cold fallback `:416-427`; sits beside (not replacing) the existing `staleMu` interval limiter.
- **ANY-array binding read** → one `WHERE watchlist_id = ANY($1)` query grouped in Go, replacing the `listBindings` per-watchlist loop (`watchlist_repo.go:133`).
- **Test stubs** → extend `fakeBackfillSource` (`marketdata_service_test.go:696`) with `GetLatestQuotesMulti` to satisfy `MultiSymbolSource`; author a portfolio-side `MarketDataServiceClient` stub (none exists).
- **buf-gen** → after editing `marketdata.proto`, run `./scripts/buf-gen.sh` (CI `proto-freshness` enforces empty `git diff packages/proto/gen/`); `buf breaking` passes (additive).

## Existing Business Rules (preserve / extend)

All PRESERVE — a performance change preserving enriched values field-for-field.
- **PRESERVE** `@AC-7 @feature-157` "market_value/unrealized_pnl match between ListPositions and the ListPortfolios card" (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`) — the read-path parity the batch switch must not break.
- **PRESERVE** `@AC-12 @feature-157` "short unrealized_pnl = (250.00 - current_price) * 5" — short-side mark-to-market from the quote's price must be unchanged.
- **PRESERVE** `@AC-12 @feature-163` "source/as_of identical across ListPositions and buildAccountPortfolio/ListPortfolios" (`.../snapshot-offline-positions.feature`) — provenance parity across the two enrichment paths modified.
- **PRESERVE** `@AC-1/@AC-2 @feature-167` (`.../watchlist-single-strategy-update.feature`) — per-symbol `strategy_id` bindings and per-binding `source` must survive the collapsed single-query read field-for-field.
- **PRESERVE** `@AC-1 @feature-154` (`.../fundsignal-watchlist-universe.feature`) — distinct cross-user union of watchlist symbols; **conditional** — if the collapse touches the shared `ListAllWatchlistSymbols` query, re-verify its `@AC-2` PERMISSION_DENIED authz gate.
- **C-16 blind spot (net-new, author here)**: marketdata has NO `@AC-*` for quote correctness, missing-quote null-not-zero, or the batch/single-flight behavior. Author these as this feature's own `@AC-*` (already in `acceptance.feature`); treat the absence as a gap this feature closes, not "nothing to preserve".

## Dependencies

- Proto/RPC: **additive** new `GetLatestQuotes` RPC + `GetLatestQuotesRequest`/`GetLatestQuotesResponse` on `marketdata.proto` (mirror `GetFundamentalsMulti`, new message field numbers from 1). Non-breaking → `buf breaking` passes; still `buf lint` + buf-gen + Proto Reviewer + marketdata owner gate.
- Migration: none (FR-2 is a query-shape rewrite over existing `watchlist_symbols` PK).
- Config keys: none.
- Inter-service edges: portfolio→marketdata gains the batch call (replaces N singular calls); no new edge.
- New env vars / ports: none.

## Risks / Not-found

- **Feature 172 SAME-FUNCTION collision (upgraded from soft rebase)**: 172 edits `checkRiskLimits` (adds `evaluateDrawdowns` + `GetAccountDrawdowns` at `portfolio_service.go:750`, per its impl-spec:236-280); 178 rewrites the `GetLatestQuote` loop **inside the same `checkRiskLimits`** `:731-737`. Not disjoint — expect a same-function merge conflict; coordinate landing order (design should note 178 batches the loop while leaving 172's drawdown logic intact), do not blind-rebase. Other 178 sites (enrichPositions, GetPnL, broadcastSnapshot) are disjoint from 172.
- **Batch response shape fork**: `GetLatestQuotesResponse` as `map<string,Quote>` vs `repeated Quote` (mirror `GetFundamentalsMulti`'s `repeated`). Absent-symbol semantics must be explicit either way (partial result).
- **Single-flight keying**: key by `symbol` for the cold fallback; confirm it composes with the existing `staleMu` `(symbol,timeframe)` interval limiter without deadlock.
- No marketdata mock in portfolio tests → a new stub is required (small scope).

## Recommended Scope

1. Proto: add `GetLatestQuotes` RPC + messages (mirror `GetFundamentalsMulti`); buf-gen. (FR-1 proto)
2. Marketdata: implement the batch service method wrapping `alpaca.GetLatestQuotesMulti` + handler/adapter; add single-flight to the cold fallback. (FR-1, FR-3)
3. Portfolio: switch `enrichPositions` + the three inline loops to one `GetLatestQuotes` call, preserving the null-not-zero skip; author the marketdata stub for tests. (FR-1, FR-4)
4. Portfolio: collapse `listBindings` into one `ANY`-array query. (FR-2)
Sequence step 3's `checkRiskLimits` edit to reconcile with feature 172. Each step: equivalence test vs serial + a missing-quote (null-not-zero) test.
