# Recon: fix-book-portfolio-page

**Created**: 2026-10-16
**From**: product-spec.md
**Affected services**: xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-config (xstockstrat-ui surface only)

---

## Objective

Book → Portfolio hangs because portfolio's quote enrichment waits on marketdata `GetLatestQuotes` with no deadline. The
batch quote read scans every hourly chunk of the never-pruned `marketdata.quotes` hypertable, which starves marketdata's
2-connection pool.

The fix:
- bounds the portfolio hop with a deadline (timeout leaves positions unenriched);
- bounds the quote reads with a 7-day recency window;
- detaches the cold-fetch singleflight from the first caller;
- prunes `marketdata.quotes` with an app-level `drop_chunks` loop on `marketdata.retention.quotes_days`.

## Codebase Map

- **`xstockstrat-portfolio`** (Go)
  - Choke point: `latestQuotesFor` — `services/xstockstrat-portfolio/internal/service/portfolio_service.go:388`. It calls
    `GetLatestQuotes` at `:393`; on error it logs a WARN and returns an empty map (`:394-396`).
  - Callers:
    - `enrichPositions` `:404`, call at `:414`, which reaches:
      - `GetPortfolio` `:537`/`:544`
      - `GetPosition` `:568`/`:574`
      - `ListPositions` `:579`/`:595`
      - `ListPortfolios` `:1226` via `buildAccountPortfolio` `:1185`/`:1191`
    - `GetPnL` `:604`, call at `:615`.
    - `broadcastSnapshot` `:789`, call at `:799`, reached from `processOrderFill` `:365`.
    - `checkRiskLimits` `:846`, call at `:860`, reached from `processOrderFill` `:364`.
  - Marketdata client: `marketdata marketdatav1.MarketDataServiceClient`, field `:42`, dialled at `:125` with
    `clientKeepAlive` `:101-105`. No per-call deadline exists anywhere in the service package.
  - Config: field `cfg *config.Watcher` `:39`.
    - `config.Watcher.GetInt(key, default)` — `internal/config/config.go:126`. Missing key or type mismatch returns the
      default.
    - Nil-guard precedent: `enrichRisk` `:438` (`if s.cfg != nil`).
    - Per-call int read example: `:1461-1462` (`portfolio.watchlist.max_per_user`).
  - Last migration: n/a (no schema change).
- **`xstockstrat-marketdata`** (Go)
  - Quote SQL (`internal/repository/marketdata_repo.go`):
    - `InsertQuote` `:264` — `ON CONFLICT (symbol, time) DO UPDATE`.
    - `GetLatestQuote` `:280` — `WHERE symbol=$1 ORDER BY time DESC LIMIT 1`. **No time predicate.**
    - `GetLatestQuotesBatch` `:313` — `DISTINCT ON (symbol) … WHERE symbol = ANY($1) ORDER BY symbol, time DESC`.
      **No time predicate.**
    - All three run on `r.pool`, not the pgxmock seam `r.db execer` (`:23`, `:30-35`, `NewMarketDataRepo` `:38`).
  - Service (`internal/service/marketdata_service.go`):
    - `GetLatestQuote` `:505`.
    - `GetLatestQuotes` `:534`. Its singleflight `quoteSingleflight` is declared at `:59` and called at `:561`. The
      closure uses the raw caller `ctx` for `GetLatestQuotesMulti` (`:570`) and `InsertQuote` (`:582`).
    - Handler: `marketdata_handler.go:100` and `:253`. Internal caller: `livePrice` `:1643`.
  - Schema: `marketdata.quotes`, `PRIMARY KEY (symbol, time)`, `chunk_time_interval => INTERVAL '1 hour'`,
    `idx_quotes_symbol_time (symbol, time DESC)` — `migrations/001_marketdata_hypertables.up.sql:38-57`.
    - Last migration is `009_symbol_classification`, and `007` does not exist. 229 adds no migration.
  - Background loops, started as `go svc.StartX(ctx)` at `cmd/server/main.go:156-162` (root ctx at `:38`, `cancel()` on
    signal at `:190-197`):
    - `StartWarmQuotePoller` `:913` reads its interval live each tick (`:926-933`); `<=0` pauses it.
    - `StartBarIngestPoller` `:988` follows the same pattern.
    - `StartClassificationRefreshPoller` (`classification_service.go:224`) is hours-based, with a 1-minute first tick.
  - Config: `config.Watcher.GetInt` (`internal/config/config.go:156`); a non-`IntVal` value reads as the default
    (`:156-167`).
  - Pool: `pool.go` sets `defaultMaxConns = 2`. When `DB_PGBOUNCER` is set it uses `QueryExecModeExec` (`:31-33`).
- **`xstockstrat-config`** (Node/TS)
  - `SCALAR_BOUNDS_REGISTRY` — `src/grpc/configServiceImpl.ts:100-134`. The 227 entries are at `:128-133`.
    - `lookupScalarBounds` `:139-140` accepts both key forms.
    - It is enforced in `SetConfig` at `:418-430` (INVALID_ARGUMENT), before the existence gate at `:453-458` (NOT_FOUND
      unless `create_key`).
  - Tests: `src/__tests__/setConfigScalarBounds.test.ts`. The `TIMEOUT_KEY_FORMS` table is at `:259-268` and the loop at
    `:270-288`.
  - Last migration: `030_marketdata_edgar_snapshot_keys` (a seed would be `031`).

## Patterns to REUSE

- **Detached cold-fetch budget.** Reuse feature 227's `BatchGetLatestPrice` shape:
  - `context.WithTimeout(context.WithoutCancel(ctx), budget)` — `marketdata_service.go:771-775`;
  - the `intGetter` seam `:106` and field `budgetCfg` `:101`, assigned only when non-nil (`:199-202`);
  - a resolver modelled on `resolveBatchPriceBudget` `:877`.
- **Hang/budget tests.** Copy the 227 harness from `marketdata_service_test.go`:
  - helpers: `fakeIntGetter` `:1582`, `budgetCfgMs` `:1605`, `callBatchPriceGuarded` `:1610`, `installWarnRecorder` `:1573`;
  - fakes: `fakeBatchPriceSource.multiBlock` `:1322`, and `fakeMultiSource` `:991` for the quote single-flight;
  - test shape: `TestBatchGetLatestPrice_DetachedFromCallerCancel` `:1810`, `TestResolveBatchPriceBudget` `:1824`.
- **Retention loop.** Mirror `StartWarmQuotePoller` `:913`: live interval and key read each tick, `<=0` pauses, exit on
  `ctx.Done()`, wired at `cmd/server/main.go:156-162`.
- **Repo SQL tests.** Use the pgxmock `execer` seam (`marketdata_repo.go:23`, test pattern `marketdata_repo_test.go:156`).
  The quote methods must move from `r.pool` to `r.db` to be testable.
- **Portfolio deadline.** Use a nil-guarded config read (`enrichRisk` `:438` precedent) and the existing error path in
  `latestQuotesFor` `:394-396`. Extend the `stubMarketData` fake (`portfolio_service_test.go:18`) so it honours ctx.
- **Bounds.** Add `SCALAR_BOUNDS_REGISTRY` rows and `TIMEOUT_KEY_FORMS` rows covering both key forms.
- **Key log.** Add a Per-Feature Registered Keys entry in `docs/patterns/config-governance.md`, newest first, above the
  227 entry (`:109-123`), with a seeding waiver like 227's D2.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-178` "Position enrichment uses one batched quote call"
  (`services/xstockstrat-portfolio/acceptance/quote-fanout-batching.feature`). Keep one `GetLatestQuotes` per read, with
  no retry or split on timeout. **The batch must equal the serial `GetLatestQuote` result**, so the recency window has
  to apply to both readers.
- **PRESERVE** `@AC-4 @feature-178` "A symbol with no quote maps to the same missing outcome under batching" (same
  suite). Timeout and out-of-window-plus-failed-live-fetch both take the existing skip: never a zero price or P&L.
- **PRESERVE** `@AC-7`, `@AC-12`, `@AC-14 @feature-157`
  (`services/xstockstrat-portfolio/acceptance/offline-account-portfolios.feature`):
  - ListPositions and ListPortfolios agree on valuation.
  - A short position is never priced at 0.
  - Broker-valued positions keep skipping enrichment.
- **PRESERVE** `@AC-12 @feature-163` (`services/xstockstrat-portfolio/acceptance/snapshot-offline-positions.feature`).
  Provenance is consistent across read paths.
- **EXTEND** `@AC-3 @feature-178` "Concurrent cold-symbol requests coalesce to one Alpaca fetch"
  (`services/xstockstrat-marketdata/acceptance/quote-fanout-batching.feature`). Adds a first-caller-cancel case.
- **PRESERVE** `@AC-3 @feature-227` (`services/xstockstrat-marketdata/acceptance/fix-opportunities-read-hangs.feature`).
  BatchGetLatestPrice logging stays as it is if any helper is shared.
- **EXTEND** `@AC-8 @feature-182` (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`).
  The new keys are rejected out of bounds.
- **PRESERVE** the shared-registry guarantees:
  - `@AC-9 @feature-182`;
  - `@AC-4`, `@AC-8 @feature-184` (`opportunity-config-operability.feature`);
  - `@AC-11`, `@AC-12 @feature-161` (`surface-signal-weight-decay-config.feature`).
- **PRESERVE** the UI offline-card rules `@AC-3`, `@AC-13 @feature-157`, `@AC-2`, `@AC-3`, `@AC-4 @feature-159`
  (`services/xstockstrat-ui/acceptance/{offline-account-portfolios,fix-offline-account-ui-gaps}.feature`).
- **PRESERVE** `@AC-5 @feature-210` (`docs/sdd/business-rules/platform.feature`). The header trio still propagates on
  the deadline-bounded call.
- xstockstrat-agent: no existing rule covers `get_positions` valuation.

## Dependencies

- Proto/RPC: none. `GetLatestQuotesRequest { repeated string symbols = 1; }` and
  `GetLatestQuotesResponse { repeated Quote quotes = 1; }` are unchanged (`packages/proto/marketdata/v1/marketdata.proto:314,318`).
- Migration: none. Retention is an application `drop_chunks` loop.
- Config keys (all int, unseeded under a waiver per the 227 D2 precedent; bounded):
  - `portfolio.marketdata.quote_timeout_ms` (new)
  - `marketdata.quotes.latest_lookback_hours` (new)
  - `marketdata.quotes.batch_timeout_ms` (new)
  - `marketdata.retention.quotes_days` (existing documented key, newly implemented)
- Inter-service edges: unchanged (portfolio → marketdata `GetLatestQuotes`, gRPC).
- New env vars / ports: none.

## Risks / Not-found

- **Unverified on staging.** Repo evidence cannot confirm two things:
  - that `drop_chunks` is available (`SHOW timescaledb.license`);
  - that marketdata's pooled role owns `marketdata.quotes`.

  Both are the same DO-bound credential (`.do/app.yaml:84`, `:673-675`), but the backend user of the PgBouncer pool is
  configured on DO's side. The loop must log a WARN on failure and never crash.
- **First-run size.** Staging has held quotes since 2026-05-27, about 142 days. With a 90-day retention the first run
  drops about 52 days of hourly chunks, roughly 1,250 chunks or about 3,750 AccessExclusive locks. That fits the
  ~25,600 lock budget (`docs/runbooks/ohlcv-lock-budget-tuning.md:63`), but it should be batched to avoid SQLSTATE
  53200 (the feature-153 class).
- **Plan-time chunk exclusion.** The window bound only holds if the cutoff is known at plan time (`now() - interval` or
  an inlined parameter under `QueryExecModeExec`). See the runbook's assumption #1.
- **fails.md "fix-ohlcv-chunk-lock-oom".** Fix every structurally identical site. The singular `GetLatestQuote` is the
  sibling unbounded reader.
- **fails.md "fix-opportunities-bars-fetch-oom".** The root cause is evidence-backed but the chunk count is unmeasured.
  Name the substitute proof explicitly.
- **Nil watcher panic.** Feature-178 portfolio tests build `&PortfolioService{marketdata: stub}` with a nil `cfg`, and
  `GetInt` on a nil `*Watcher` panics. Guard the read.
- **Not found:**
  - a stub that simulates a hanging `GetLatestQuotes` in portfolio;
  - quote SQL unit tests;
  - any reader of `marketdata.retention.quotes_days`;
  - any `drop_chunks` / `show_chunks` usage in the repo;
  - any caller of `StartSnapshotWriter`.
- Overlap: feature 215 (in-progress) edits other functions of `marketdata_service.go` (rebase-only).

## Recommended Scope

1. Config bounds: 4 registry rows plus tests.
2. Marketdata repo:
   - move the quote SQL onto the `r.db` seam;
   - add a recency predicate to `GetLatestQuote` and `GetLatestQuotesBatch`;
   - add a retention method (`drop_chunks`) with pgxmock tests.
3. Marketdata service:
   - lookback resolver;
   - detached cold-fetch budget in `GetLatestQuotes`;
   - `StartQuoteRetention` loop with batched first-run drops and WARN on failure;
   - tests;
   - wiring in `main.go`.
4. Portfolio: deadline in `latestQuotesFor` (nil-guarded resolver) plus a ctx-honouring stub test.
5. Docs: CLAUDE.md key tables, the config-governance log, the marketdata findings row, the defect status, and the
   context-forge teardown.
