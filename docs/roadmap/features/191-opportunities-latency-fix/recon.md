# Recon: opportunities-latency-fix

**Created**: 2026-09-09
**From**: product-spec.md
**Affected services**: `packages/proto`, `xstockstrat-marketdata`, `xstockstrat-analysis`, `xstockstrat-ui`

---

## Objective

Fix the 2.9-minute `ListOpportunities` latency by adding batch marketdata RPCs (`BatchGetBars`, `BatchGetLatestPrice`), parallelizing sequential Phase 0 drains via `asyncio.gather`, aligning the live enrichment memo TTL with the browser poll interval, and adding a BFF-side gRPC deadline to prevent unbounded calls that exceed the DigitalOcean proxy timeout.

## Codebase Map

### `packages/proto` (Protobuf)
- Proto file: `packages/proto/marketdata/v1/marketdata.proto`
- Existing batch RPCs: `GetFundamentalsMulti` (line 44), `GetLatestQuotes` (line 48) — templates for new batch RPCs
- `GetBars` RPC (line 37): single-symbol, `GetBarsRequest` at line 103 (`string symbol = 1`)
- `GetLatestPrice` RPC (line 43): single-symbol
- `LatestPrice` message (lines 82–88): explicit-presence `optional double last_price/prev_close`
- Codegen: `./scripts/buf-gen.sh`

### `xstockstrat-marketdata` (Go)
- Entry point: `cmd/server/main.go:152` — `RegisterMarketDataServiceServer(grpcServer, hdl.GRPCHandler())`
- Handler DI: `internal/handler/marketdata_handler.go:27` — `NewMarketDataHandler(svc)`
- gRPC adapter: `internal/handler/marketdata_handler.go:215` — `GRPCHandler()` returns `grpcMarketDataAdapter`
- **GetBars chain**: handler `:84` → service `:127` → repo `QueryBars` `:85` (SQL: `WHERE symbol=$1 AND timeframe=$2`)
- **GetBars (recent)**: repo `QueryRecentBars` `:164` (SQL: `WHERE symbol=$1 AND timeframe=$2 … ORDER BY time DESC`)
- **GetLatestPrice chain**: handler `:108` → service `:520` → Alpaca `LatestTradeSource.GetLatestTrade` `:527` + repo `GetPreviousDailyClose` `:192`
- **GetLatestQuotes batch (template)**: handler `:194` → service `:442` (warm DB → cold singleflight → `MultiSymbolSource.GetLatestQuotesMulti`) → repo `GetLatestQuotesBatch` `:311` (SQL: `WHERE symbol = ANY($1)`)
- **GetFundamentalsMulti**: handler `:183` → service `:1061` (cache-first, then batch-fetch)
- **`MultiSymbolSource` interface**: `internal/source/source.go:24–27` — already defines `GetBarsMulti` + `GetLatestQuotesMulti`
- **Alpaca `GetBarsMulti`**: `internal/alpaca/client.go:300` — implemented but **not wired** to any handler/service RPC
- Pool: `internal/repository/pool.go:15` — `defaultMaxConns = 2`, PgBouncer `:25061`

### `xstockstrat-analysis` (Python)
- Entry point: `app/main.py:65` — `marketdata_channel=grpc.aio.insecure_channel(MARKETDATA_ENDPOINT)`
- Stub: `app/handlers/servicer.py:386` — `MarketDataServiceStub(marketdata_channel)`
- **`_bars_fetch_sem`**: `servicer.py:412` — `Semaphore(max(1, get_int("analysis.opportunity.max_concurrent_bars_fetches", 2)))` — default **2**
- **Phase 0 drains** (sequential, no ordering dependency):
  - `servicer.py:3557` — `_drain_active_signals`
  - `servicer.py:3566` — `_drain_held_symbols`
  - `servicer.py:3567` — `_drain_watchlist_bindings`
  - `servicer.py:3569` — `_drain_source_weights`
- **Phase 1 bars fetch**: `servicer.py:3837–3846` — `_fetch_into` acquires `_bars_fetch_sem`, `asyncio.gather` over `unique_symbols`
- **Phase 1 benchmark bars**: `servicer.py:3851–3872` — `_fetch_benchmark_into` also acquires `_bars_fetch_sem`
- **Phase 2 benchmark cache-miss**: `servicer.py:3895` — `_load_benchmark_bars_windowed` passes `sem=self._bars_fetch_sem`
- **`_enrich_opportunities_live`**:
  - `servicer.py:3444` — sem for `GetLatestPrice`
  - `servicer.py:3458` — sem for `GetBars` sparkline
  - `servicer.py:3480` — `asyncio.gather` over `by_symbol.items()`
- **`live_enrich_ttl_seconds`**: `servicer.py:3411` — `get_int_present("analysis.opportunity.live_enrich_ttl_seconds", 10)`; memo dict at `:479`, expiry check at `:3434`, write at `:3473`
- **All `_bars_fetch_sem` sites**: `:3444`, `:3458`, `:3838`, `:3852`, `:3895` (5 sites)

### `xstockstrat-ui` (Next.js)
- **`makeTransport`**: `src/lib/connectClients.ts:26–28` — `createGrpcTransport({ baseUrl })` — **no timeout**
- **`analysisClient`**: `src/lib/connectClients.ts:36` — `createClient(AnalysisService, makeTransport(ANALYSIS_ENDPOINT))`
- **`forward()` helper**: `src/lib/bffShared.ts:60–67` — passes only `{ headers }` to downstream — **no `timeoutMs`/signal**
- **`listOpportunities` handler**: `src/lib/insightsBff.ts:54` — `forward((req, opts) => analysisClient.listOpportunities(req, opts))`
- **`useOpportunities` hook**: `src/hooks/useOpportunities.ts:16–21` — `refetchInterval: 15_000`
- **No existing per-call timeout pattern**: zero matches for `timeoutMs`, `deadline`, `AbortSignal`, `CallOptions`, `defaultTimeoutMs` across the entire UI codebase

## Patterns to REUSE

- **Batch RPC SQL** → reuse `WHERE symbol = ANY($1)` pattern from `GetLatestQuotesBatch` at `internal/repository/marketdata_repo.go:316`
- **Batch service warm/cold split** → reuse warm-DB → cold-singleflight → `MultiSymbolSource` pattern from `GetLatestQuotes` service at `internal/service/marketdata_service.go:442`
- **`MultiSymbolSource.GetBarsMulti`** → existing interface + Alpaca implementation at `internal/source/source.go:24` / `internal/alpaca/client.go:300` — wire into new batch handler
- **Handler → gRPC adapter pattern** → replicate `GetLatestQuotes` handler/adapter at `internal/handler/marketdata_handler.go:194,337`
- **Dedup-then-semaphore pattern** (ledger insight 141) → reuse `dict.fromkeys` dedup from Phase 1 at `servicer.py:3845`; batch RPCs eliminate the per-symbol sem acquisition entirely
- **`asyncio.gather` parallelism** → already used in Phase 1 (`servicer.py:3846`) and enrichment (`servicer.py:3480`); extend to Phase 0 drains
- **Connect-es `CallOptions.timeoutMs`** → new pattern for the UI BFF, applied via `forward()` plumbing at `src/lib/bffShared.ts:60`

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-14 @FR-8 @feature-095` "Folding in the live quote does not leak look-ahead into ranking" (`services/xstockstrat-analysis/acceptance/opportunity-live-market-enrichment.feature`) — live quote is presentation-only; batch enrichment must not change what enters ranking
- **PRESERVE** `@AC-1 @FR-1 @feature-095` "Queue card shows live price and change%" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — batch price fetch must still deliver per-card live price/change
- **PRESERVE** `@AC-3 @FR-2 @feature-095` "Queue card renders a price sparkline from recent bars" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — batch bars must deliver per-symbol bar series
- **PRESERVE** `@AC-4 @FR-2 @FR-6 @feature-095` "Sparkline warm-up gap renders as null, never NaN" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — null-not-NaN serialization contract
- **PRESERVE** `@AC-11 @FR-6 @feature-095` "Unavailable live quote omits the price field, never fabricates" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — batch RPC partial-response (omit missing, never zero-fill)
- **PRESERVE** `@AC-12 @FR-7 @feature-095` "Live price on Decide surface equals Signal-detail surface" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — cross-surface parity from single fetch
- **CHANGE** `@AC-5 @FR-4 @feature-177` "Warm reads skip live enrichment when values are fresh" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — feature explicitly aligns memo TTL (`live_enrich_ttl_seconds`); guarantee shape preserved but TTL value changes from 10→≥15
- **PRESERVE** `@AC-4 @FR-3 @feature-177` "Empty-universe user does not recompute on every poll" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — Phase 0 parallelization must not break empty-universe suppression
- **PRESERVE** `@AC-2 @FR-1 @FR-5 @feature-177` "New bar busts the readiness cache" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — bar-epoch cache bust
- **PRESERVE** `@AC-3 @FR-2 @feature-177` "Remount within staleTime does not refetch" (`services/xstockstrat-ui/acceptance/readiness-caching-poll-discipline.feature`) — BFF deadline must not break client staleTime
- **PRESERVE** `@AC-3 @feature-178` "Concurrent cold-symbol requests coalesce to one Alpaca fetch" (`services/xstockstrat-marketdata/acceptance/quote-fanout-batching.feature`) — new batch RPCs must preserve singleflight coalescing
- **PRESERVE** `@AC-1 @regression @feature-153` "400-day bars query does not exhaust cluster lock table" (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature`) — batch bars must not regress lock budget
- **PRESERVE** `@AC-8 @FR-6 @feature-158` "Daily opportunity refresh re-anchors to wall-clock hour across redeploy" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — Phase 0 parallelization must not break schedule
- **PRESERVE** `@AC-9 @FR-6 @feature-158` "Opportunity refresh retries soon after enumeration failure" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — retry cadence preserved

## Dependencies

- **Proto/RPC**: New `BatchGetBars`, `BatchGetLatestPrice` RPCs + 5 new messages in `packages/proto/marketdata/v1/marketdata.proto`. Next field numbers after existing ~line 240. Additive only — no breaking change.
- **Migration**: none (no schema changes)
- **Config keys**: `analysis.opportunity.live_enrich_ttl_seconds` (existing, default raised 10→15)
- **Inter-service edges**: `xstockstrat-analysis → xstockstrat-marketdata` (existing, new RPC methods on same channel)
- **New env vars / ports**: none

## Risks / Not-found

- **Ledger 141 trap**: batch handler must use `WHERE symbol = ANY($1)` single-query pattern, not per-symbol goroutine fan-out — validated: `GetLatestQuotesBatch` already follows this at `marketdata_repo.go:316`.
- **`GetLatestPrice` is NOT purely DB**: it calls Alpaca `GetLatestTrade` for live price + repo `GetPreviousDailyClose` for prev close. The batch variant needs a multi-symbol Alpaca fetch for live trades — `MultiSymbolSource` does NOT currently define `GetLatestTradesMulti` (only `GetLatestQuotesMulti`). The batch handler must either add a new source method or batch the Alpaca calls differently.
- **Lock budget on batch bars**: `@AC-1 @feature-153` enforced; the `WHERE symbol = ANY($1)` batch query hits multiple symbols' hypertable chunks simultaneously — must verify the lock count stays safe for ~100 symbols. The existing single-symbol `QueryBars` does `LIMIT` per symbol; the batch variant must preserve pagination/limits.
- **BFF timeout is first-of-its-kind**: no existing timeout pattern in the UI codebase. Connect-es `CallOptions` supports `timeoutMs`; the `forward()` helper needs plumbing to accept and pass it through.
- **Phase 2 benchmark cache-miss** (`servicer.py:3895`): also acquires `_bars_fetch_sem` — batch RPCs should cover this path too, or the sem hold time is already minimal (single symbol fallback).

## Recommended Scope

1. **Proto**: define `BatchGetBarsRequest/Response`, `SymbolBars`, `BatchGetLatestPriceRequest/Response` in `marketdata.proto`; run `buf-gen.sh`
2. **Marketdata Go — BatchGetBars**: repo method (`WHERE symbol = ANY($1)` with per-symbol pagination), service method (warm DB → cold `GetBarsMulti`), handler + gRPC adapter
3. **Marketdata Go — BatchGetLatestPrice**: repo method (batch `GetPreviousDailyClose`), service method (batch Alpaca trades + batch prev close), handler + gRPC adapter
4. **Analysis Python — Phase 0 parallelize**: wrap 4 drain calls in `asyncio.gather`
5. **Analysis Python — Phase 1 batch bars**: replace per-symbol `GetBars` + sem with single `BatchGetBars` call
6. **Analysis Python — enrichment batch**: replace per-symbol `GetLatestPrice` + `GetBars` + sem with `BatchGetLatestPrice` + `BatchGetBars`
7. **Analysis Python — TTL raise**: change default from 10 to 15 for `live_enrich_ttl_seconds`
8. **UI — BFF deadline**: add `timeoutMs` plumbing to `forward()` or the analysis transport; set 30s for `listOpportunities`
