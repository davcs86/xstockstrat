# Design: opportunities-latency-fix

**Created**: 2026-09-09
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-09-09
**Grounded in**: recon.md

---

## Chosen Approach

An 8-step, additive-only approach that eliminates per-symbol RPC serialization at three layers
(Phase 0 drains, Phase 1 bars fetch, live enrichment), adds a BFF-side deadline to prevent
unbounded calls, and aligns the memo TTL with the browser poll interval. The consumer surface
(`xstockstrat-ui` `/insights` segment) is reached by Step 8 (BFF deadline plumbing); the backing
analysis and marketdata services are reached by Steps 1–7.

### Step 1 — Proto (additive only)

Define 5 new messages and 2 new RPCs in `packages/proto/marketdata/v1/marketdata.proto`
(recon: `marketdata.proto` ends at ~line 239, service block ends at ~line 49):

- `BatchGetBarsRequest` — `repeated string symbols`, `string timeframe`, `google.protobuf.Timestamp start/end`, `int32 max_bars_per_symbol`
- `BatchGetBarsResponse` — `repeated SymbolBars results`
- `SymbolBars` — `string symbol`, `repeated Bar bars`
- `BatchGetLatestPriceRequest` — `repeated string symbols`
- `BatchGetLatestPriceResponse` — `repeated LatestPrice results` (reuses existing `LatestPrice` message at recon `marketdata.proto:82–88`)
- RPCs: `BatchGetBars`, `BatchGetLatestPrice` added to `MarketDataService`

Run `./scripts/buf-gen.sh`. No breaking changes — `buf breaking` passes.

### Step 2 — Marketdata Go: BatchGetBars handler/service/repo

**Repo**: LATERAL JOIN query as the primary pattern — `SELECT b.* FROM unnest($1::text[]) AS s(sym) CROSS JOIN LATERAL (SELECT * FROM bars WHERE symbol = s.sym AND timeframe = $2 AND time >= $3 AND time < $4 ORDER BY time ASC LIMIT $5) b` (recon: `QueryBars` at `marketdata_repo.go:85`, existing index `(symbol, time DESC)` at migration `001:31-32`; timeframe is a post-index filter, not part of the index). The `LIMIT $5` is `max_bars_per_symbol`, clamped to `[1, 5000]` server-side (recon: repo cap at `marketdata_repo.go:86`). Enforce `timeframe = "1d"` only — return `InvalidArgument` for other timeframes (the only consumer is analysis Phase 1, which exclusively uses daily bars; arbitrary-timeframe batch is deferred to avoid combinatorial lock-budget risk).

**Service**: warm DB → cold singleflight → `MultiSymbolSource.GetBarsMulti` (recon: template at `marketdata_service.go:442`; `GetBarsMulti` interface at `source.go:24`, Alpaca implementation at `alpaca/client.go:300`). Singleflight groups keyed by `batch:{sorted_symbols}:{timeframe}:{start}:{end}`.

**Handler + gRPC adapter**: replicate the 3-method pattern from `GetLatestQuotes` (recon: `marketdata_handler.go:194,337,353`).

**Lock budget**: TimescaleDB partitions by time (30-day chunks), NOT by symbol — a LATERAL JOIN over N symbols touching the same time range locks ~14 chunks (400 days ÷ 30 days/chunk), regardless of N. This stays well within `max_locks_per_transaction = 1024` (per `docs/runbooks/ohlcv-lock-budget-tuning.md`). Preserves `@AC-1 @regression @feature-153`.

**gRPC receive limit**: set `grpc.max_receive_message_length = 8 * 1024 * 1024` (8 MB) on the analysis-side channel options (recon: `app/main.py:65` creates the channel with no options; default is 4 MB). Worst case: 100 symbols × 400 bars × ~80 bytes/bar ≈ 3.2 MB, well within 8 MB.

### Step 3 — Marketdata Go: BatchGetLatestPrice handler/service/repo

**Repo**: batch `GetPreviousDailyClose` via `ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY time DESC)` with `WHERE symbol = ANY($1) AND timeframe = '1d' AND time < $2` (recon: single-symbol `GetPreviousDailyClose` at `marketdata_repo.go:192`; batch template at `GetLatestQuotesBatch:311-320`).

**Service**: new `GetLatestTradesMulti` method on `MultiSymbolSource` interface (recon: `source.go:24-27` already defines `GetBarsMulti` + `GetLatestQuotesMulti` but NOT `GetLatestTradesMulti`). Alpaca implementation type-asserts `MultiSymbolSource` at runtime; if the source doesn't implement it, fall back to per-symbol `GetLatestTrade` (preserves non-Alpaca source compatibility). Singleflight groups keyed by `batch-price:{sorted_symbols}`.

**Omit-not-fabricate**: symbols missing from the Alpaca response or the DB are omitted from the `BatchGetLatestPriceResponse` map, never zero-filled — preserves `@AC-11 @FR-6 @feature-095` ("Unavailable live quote omits the price field, never fabricates").

### Step 4 — Analysis Python: Phase 0 drain parallelization

Replace the 4 sequential drain calls (recon: `servicer.py:3557-3569`) with `asyncio.gather`:

```python
signals, held, bindings, weights = await asyncio.gather(
    self._drain_active_signals(...),
    self._drain_held_symbols(...),
    self._drain_watchlist_bindings(...),
    self._drain_source_weights(...),
)
now_utc = datetime.now(tz=timezone.utc)  # AFTER gather, not before
```

`now_utc` must be captured AFTER the gather completes — the existing code uses it as the
reference timestamp for freshness checks; capturing it before would make the timestamp stale by
the duration of the slowest drain.

### Step 5 — Analysis Python: Phase 1 batch bars

Replace the per-symbol `GetBars` + semaphore loop (recon: `servicer.py:3837-3846`, acquiring `_bars_fetch_sem` per symbol) with a single `BatchGetBars` call. `max_bars_per_symbol` derived from the actual date range (`(end - start).days`, roughly 252 trading days for a 400-calendar-day lookback), NOT from the pagination constants `_BAR_PAGE_SIZE=1000` / `_MAX_BAR_PAGES=32` (recon: `servicer.py:247,251`).

### Step 6 — Analysis Python: enrichment batch

Replace per-symbol `GetLatestPrice` + `GetBars` sparkline (recon: `servicer.py:3444,3458`, each acquiring `_bars_fetch_sem`) with `BatchGetLatestPrice` + `BatchGetBars`, wrapped in `try/except`: on transport error, fall back to per-symbol enrichment (preserves `@AC-11` partial-availability guarantee). This eliminates 2× semaphore acquisitions per symbol in the enrichment path.

### Step 7 — Analysis Python: TTL raise

Change `live_enrich_ttl_seconds` default from 10 to 20 (recon: `servicer.py:3411`). The browser polls every 15s (`refetchInterval: 15_000` at recon `useOpportunities.ts:16-21`); React Query v5 counts `refetchInterval` from query *completion*, not start — so TTL must exceed `interval + response_time`. With batch RPCs the response should be ~2-5s; 20s provides comfortable margin. This is a **CHANGE** to `@AC-5 @FR-4 @feature-177` ("Warm reads skip live enrichment when values are fresh") — the guarantee shape is preserved but the TTL value increases.

### Step 8 — UI BFF: deadline plumbing

Widen `forward()` opts type (recon: `bffShared.ts:60-67`) from `{ headers: Headers }` to `{ headers: Headers; timeoutMs?: number }`, passing `timeoutMs` through to the Connect-es `CallOptions`. In `listOpportunities` handler (recon: `insightsBff.ts:54`), pass `timeoutMs: 30_000`. Uses Connect-es per-call `CallOptions.timeoutMs` (NOT a transport-level `defaultTimeoutMs`, which does not exist).

## Rejected Alternatives

- **Streaming `BatchGetBars`** — rejected because it adds server-streaming complexity (backpressure, partial-failure semantics) for a use case that fits comfortably in a unary response (~3.2 MB worst case with the 8 MB receive limit). Breaks the existing unary RPC pattern used by all other marketdata RPCs.
- **Flat `WHERE symbol = ANY($1)` without per-symbol LIMIT** — rejected because it returns ALL bars for ALL symbols, potentially millions of rows. The LATERAL JOIN pushes the per-symbol LIMIT into the index scan, returning only the needed bars per symbol.
- **Raise `_bars_fetch_sem` from 2 to 5** — rejected because it gives only ~2.5× throughput improvement while batch RPCs give ~50-100× (collapsing ~100 sequential calls into 1-2). Also doesn't address the root cause (per-symbol serialization) and increases PgBouncer contention.

## Open Risks

- [ ] **EXPLAIN ANALYZE on staging** — LATERAL JOIN query plan on real data with ~100 symbols and 400-day range; verify chunk lock count stays under budget. To be validated at impl-spec Step 2 (before merge).
- [ ] **Alpaca multi-symbol trades endpoint** — `GetLatestTradesMulti` needs Alpaca API that returns trades for multiple symbols in one call; verify the endpoint exists and its rate limits. Type-assert fallback covers the risk if it doesn't.
- [ ] **Connect-es `timeoutMs` behavior** — first use of per-call timeout in the UI BFF; verify it emits a `DeadlineExceeded` status (recon: `connectClients.ts:64` already handles `DeadlineExceeded`).

## Constitution Rules Touched

- `C-04` — honored by: additive proto (new messages + RPCs only, no field removals/renames); enum zero-value conventions preserved.
- `C-08` — honored by: TTL remains a config-served value (`analysis.opportunity.live_enrich_ttl_seconds`), only the default changes.
- `C-11` — honored by: all ambiguities (lock budget, Alpaca multi-trade, LATERAL vs ROW_NUMBER) surfaced and resolved during debate, none silently guessed.
- `C-14` — honored by: UI BFF deadline (Step 8) explicitly in scope; the consumer surface (`/insights` segment) is not left stale.
- `C-16` — honored by: 14 existing business rules analyzed (13 PRESERVE, 1 CHANGE with explicit sign-off); regression guard in design.
- `F-01` — honored by: proto changes are additive only; no breaking changes, `buf breaking` passes.
- `F-04` — honored by: all codebase claims cited to `recon.md` path:line evidence; nothing invented.
- `F-11` — no Floor breaches detected across 4 rounds (16 objections, all resolved).
- `P-03` — honored by: open risks explicitly listed, not papered over.
- `P-05` — honored by: context.md session entry written at completion.

## Business Rules Touched (C-16)

- PRESERVE `@AC-14 @FR-8 @feature-095` "Folding in the live quote does not leak look-ahead into ranking" (`services/xstockstrat-analysis/acceptance/opportunity-live-market-enrichment.feature`) — not regressed by: batch enrichment is still presentation-only; ranking inputs are computed in Phase 2, after enrichment.
- PRESERVE `@AC-1 @FR-1 @feature-095` "Queue card shows live price and change%" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — not regressed by: `BatchGetLatestPrice` delivers the same per-symbol `LatestPrice` message.
- PRESERVE `@AC-3 @FR-2 @feature-095` "Queue card renders a price sparkline from recent bars" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — not regressed by: `BatchGetBars` delivers per-symbol bar series via `SymbolBars`.
- PRESERVE `@AC-4 @FR-2 @FR-6 @feature-095` "Sparkline warm-up gap renders as null, never NaN" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — not regressed by: serialization contract unchanged (same `Bar` message).
- PRESERVE `@AC-11 @FR-6 @feature-095` "Unavailable live quote omits the price field, never fabricates" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — not regressed by: omit-not-fabricate in Step 3 + enrichment fallback in Step 6.
- PRESERVE `@AC-12 @FR-7 @feature-095` "Live price on Decide surface equals Signal-detail surface" (`services/xstockstrat-ui/acceptance/opportunity-live-market-enrichment.feature`) — not regressed by: single `BatchGetLatestPrice` serves both surfaces.
- CHANGE `@AC-5 @FR-4 @feature-177` "Warm reads skip live enrichment when values are fresh" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — altered guarantee: TTL default raised 10→20s; guarantee shape preserved, only threshold changes. Signed off by user @ 2026-09-09 (context.md).
- PRESERVE `@AC-4 @FR-3 @feature-177` "Empty-universe user does not recompute on every poll" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — not regressed by: Phase 0 parallelization does not change empty-universe suppression logic.
- PRESERVE `@AC-2 @FR-1 @FR-5 @feature-177` "New bar busts the readiness cache" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`) — not regressed by: bar-epoch cache bust is in the readiness layer, upstream of Phase 0/1.
- PRESERVE `@AC-3 @FR-2 @feature-177` "Remount within staleTime does not refetch" (`services/xstockstrat-ui/acceptance/readiness-caching-poll-discipline.feature`) — not regressed by: BFF deadline (30s) is much longer than staleTime; client-side caching unaffected.
- PRESERVE `@AC-3 @feature-178` "Concurrent cold-symbol requests coalesce to one Alpaca fetch" (`services/xstockstrat-marketdata/acceptance/quote-fanout-batching.feature`) — not regressed by: new batch handlers use singleflight grouping (Step 2/3).
- PRESERVE `@AC-1 @regression @feature-153` "400-day bars query does not exhaust cluster lock table" (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature`) — not regressed by: LATERAL JOIN locks ~14 time-partitioned chunks regardless of symbol count (design § Step 2).
- PRESERVE `@AC-8 @FR-6 @feature-158` "Daily opportunity refresh re-anchors to wall-clock hour across redeploy" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — not regressed by: Phase 0 parallelization is internal to `_compute_opportunities`, not the scheduler.
- PRESERVE `@AC-9 @FR-6 @feature-158` "Opportunity refresh retries soon after enumeration failure" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — not regressed by: retry cadence is in the scheduler, not the compute function.
