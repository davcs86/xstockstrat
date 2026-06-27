# Implementation Spec: fundamentals-data-source

**Status**: `pending`
**Created**: 2026-06-27
**Feature**: `docs/roadmap/features/059-fundamentals-data-source/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/fundamentals-data-source`

---

## Execution Summary

The contract comes first: add the additive `GetFundamentals`/`GetFundamentalsMulti` RPCs and the
`Fundamentals` message to `marketdata.proto` (Step 1), regenerate stubs (Step 2). The two backing
data stores follow independently: the `marketdata.fundamentals` cache table in marketdata
(Step 3) and the six `marketdata.fmp.*` config-key seed rows in xstockstrat-config (Step 5). The
service work is layered bottom-up: the FMP client behind a new `FundamentalsSource` interface
(Step 6), the repository read-through/quota methods (Step 7), then the service + handler RPC
implementation wiring cache → quota guard → FMP fetch → 80%-warning alert (Step 8). Tests pair each
service step, and the marketdata CLAUDE.md config table is updated last (Step 11). FR-2's invariant
— the existing `source.Registry`/`DataSourceClient` Alpaca path stays untouched — is preserved by
adding a *separate* interface and a *separate* `internal/fmp/` package alongside, never editing
`internal/source/source.go`'s `DataSourceClient` or `internal/alpaca/`.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs are generated from the new RPC/message definitions.
- Step 6, 7, 8 (marketdata service/repo) require Step 2: they reference generated `marketdatav1.Fundamentals`, `GetFundamentalsRequest`, etc.
- Step 7 (repository) requires Step 3 (migration): the read-through/quota-count queries target the `marketdata.fundamentals` table.
- Step 8 (service RPC) requires Step 6 (FMP client) and Step 7 (repository): the RPC orchestrates cache read → quota check → FMP fetch → upsert.
- Step 4 (test) covers Step 3 (migration up/down). Step 9 (test) covers Steps 6–8 (FMP client + repo + service). Step 10 (test) covers Step 5 (config seed migration).
- Step 5 (config seed) is independent of the marketdata steps but is a hard runtime prerequisite for the service to ever return data (`marketdata.fmp.enabled` must exist); order it before integration but it has no code dependency on Steps 1–4.
- Step 11 (docs) requires Step 5 (the key set is finalized there).

---

### Step 1 — proto: Add GetFundamentals / GetFundamentalsMulti RPCs + Fundamentals message

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/marketdata/v1/marketdata.proto` — modify

**Reviewers**: Proto Reviewer — additive `GetFundamentals`/`GetFundamentalsMulti` RPC + messages, field-number uniqueness, `buf` pass; `xstockstrat-marketdata` (service owner) — RPC shape matches cache/quota design.

**Codebase Evidence**:
- Confirmed service block at `packages/proto/marketdata/v1/marketdata.proto:12-36`; last RPC `ListAssets` at L35. New RPCs append after L35 inside the `service` block (additive — non-breaking).
- Confirmed message style: typed scalar fields with proto3 numbering, `google.protobuf.Timestamp` imported (L7), `common/v1/common.proto` imported (L8). `Quote`/`Bar` use `string source` (`marketdata.proto:50,61`). New messages append after the last message `DeleteBackfilledDataResponse` (ends L152).
- Confirmed `BackfillBarsRequest` (L95-102) has **no `source` field** — fundamentals cannot route through backfill; a dedicated RPC is required (per product-spec Note + context.md).
- `go_package` option present at L5 — Go stubs land in `gen/go/marketdata/v1`.

**Instructions**:
1. Inside the `service MarketDataService { ... }` block, after the `ListAssets` RPC (L35), add:
   ```proto
   // Cached fundamental metrics for one symbol (FMP-backed, read-through DB cache)
   rpc GetFundamentals(GetFundamentalsRequest) returns (GetFundamentalsResponse);

   // Batched fundamentals for a watchlist scan (core metrics via one FMP quote call)
   rpc GetFundamentalsMulti(GetFundamentalsMultiRequest) returns (GetFundamentalsMultiResponse);
   ```
2. After the final message (`DeleteBackfilledDataResponse`, ends L152), append the message set. Use the exact typed core fields named in the product spec (Proto Contract Changes), keeping `string source` consistent with `Bar`/`Quote`:
   ```proto
   message Fundamentals {
     string symbol = 1;
     double market_cap = 2;
     double pe_ratio = 3;
     double pb_ratio = 4;
     double dividend_yield = 5;
     double eps = 6;
     double beta = 7;
     double roe = 8;
     double debt_to_equity = 9;
     double price = 10;
     double year_high = 11;
     double year_low = 12;
     // FMP's open-ended metric set (keys are FMP field names)
     map<string, double> extra_metrics = 13;
     google.protobuf.Timestamp as_of = 14;
     string currency = 15;
     string source = 16;   // "fmp"
     bool stale = 17;      // true when served past TTL under quota exhaustion (FR-4)
   }

   message GetFundamentalsRequest {
     string symbol = 1;
   }

   message GetFundamentalsResponse {
     Fundamentals fundamentals = 1;
   }

   message GetFundamentalsMultiRequest {
     repeated string symbols = 1;
   }

   message GetFundamentalsMultiResponse {
     repeated Fundamentals fundamentals = 1;
   }
   ```
3. Do not renumber, retype, or remove any existing field — all additions are new messages and new RPCs only.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/fundamentals-data-source"
```
Both must pass (additive change → no breaking findings).

---

### Step 2 — proto-gen: Regenerate stubs (Go / Python / TS)

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/marketdata/v1/` — modify (generated)
- `packages/proto/gen/python/` — modify (generated)
- `packages/proto/gen/ts/` — modify (generated)

**Reviewers**: Proto Reviewer — inherited from Step 1; `xstockstrat-marketdata` (service owner) — inherited.

**Codebase Evidence**:
- Generation entrypoint is `./scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs; proto-versioning.md:82-88 confirms `proto-freshness` CI enforces stubs match protos).
- Go stub target dir `packages/proto/gen/go/marketdata/v1/` confirmed by `go_package` option at `marketdata.proto:5`.

**Instructions**:
1. From repo root run `./scripts/buf-gen.sh` to regenerate TS, Python, and Go stubs and recompile the TS package.
2. Commit the regenerated stubs **together with the Step 1 proto change** (proto source + generated stubs in one commit, per proto-versioning.md PR1 convention).
3. Do not hand-edit generated files.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Exit code 0 (no diff after running) means stubs are fresh — matches the `proto-freshness` CI gate.

---

### Step 3 — migration: Create marketdata.fundamentals cache table

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/migrations/002_fundamentals.up.sql` — create
- `services/xstockstrat-marketdata/migrations/002_fundamentals.down.sql` — create

**Reviewers**: DBA — new `marketdata.fundamentals` table, index correctness, up+down pair; `xstockstrat-marketdata` (service owner) — cache schema matches read-through/quota design.

**Codebase Evidence**:
- Confirmed last migration is `001` — only `migrations/000_schema.{up,down}.sql` and `migrations/001_marketdata_hypertables.{up,down}.sql` exist (discovery digest). Next NNN = **002**.
- Schema/style reference: `migrations/001_marketdata_hypertables.up.sql:5` `CREATE SCHEMA IF NOT EXISTS marketdata;`, `:8` `CREATE TABLE IF NOT EXISTS marketdata.ohlcv (...)`, `:23` `SELECT create_hypertable(...)`, with `CREATE INDEX IF NOT EXISTS`. The `marketdata` schema already exists (000 + 001).
- Product spec (Database Changes) specifies a **plain** table (latest-snapshot semantics, not a hypertable) with an index on `fetched_at` for the day-window quota count (FR-4).

**Instructions**:
1. Create `002_fundamentals.up.sql` with the exact column set from the product spec (Database Changes), in the existing `marketdata` schema, as a **plain** table (no `create_hypertable`):
   ```sql
   CREATE TABLE IF NOT EXISTS marketdata.fundamentals (
     symbol          text PRIMARY KEY,
     as_of           timestamptz NOT NULL,
     market_cap      numeric,
     pe_ratio        numeric,
     pb_ratio        numeric,
     dividend_yield  numeric,
     eps             numeric,
     beta            numeric,
     roe             numeric,
     debt_to_equity  numeric,
     price           numeric,
     year_high       numeric,
     year_low        numeric,
     extra_metrics   jsonb NOT NULL DEFAULT '{}',
     currency        text,
     source          text NOT NULL DEFAULT 'fmp',
     fetched_at      timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS idx_fundamentals_fetched_at
     ON marketdata.fundamentals (fetched_at);
   ```
2. Create `002_fundamentals.down.sql`:
   ```sql
   DROP INDEX IF EXISTS marketdata.idx_fundamentals_fetched_at;
   DROP TABLE IF EXISTS marketdata.fundamentals;
   ```
3. Do not edit `000`/`001` migrations (never edit an applied migration — root CLAUDE.md § Database).

**Verification**: covered by Step 4. Manual check:
```bash
ls services/xstockstrat-marketdata/migrations/ | sort   # confirm 002_fundamentals.{up,down}.sql present, no NNN gap
```

---

### Step 4 — test: Verify 002 migration up/down applies cleanly

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- (no new files — runs `scripts/db-migrate.sh` against the marketdata schema)

**Reviewers**: DBA — up+down pair applies cleanly, run-order compliance; `xstockstrat-marketdata` (service owner) — table created/dropped as designed.

**Codebase Evidence**:
- Migrations run via `scripts/db-migrate.sh` (golang-migrate) per root CLAUDE.md § Database; acceptance criterion 6 requires `migrate up`/`down` to cleanly create/drop the table.

**Instructions**:
1. Apply migrations against a local TimescaleDB (see `scripts/db-migrate.sh` usage in `docs/patterns/database.md`), then roll the new one back and forward to prove the up/down pair is reversible.

**Verification**:
```bash
./scripts/db-migrate.sh marketdata up
# confirm table exists:
psql "$DATABASE_URL" -c "\d marketdata.fundamentals"
./scripts/db-migrate.sh marketdata down 1   # drops 002
./scripts/db-migrate.sh marketdata up        # re-applies 002 cleanly
```
Table present after `up`, absent after `down 1`, re-created on re-`up` — satisfies acceptance criterion 6.

---

### Step 5 — config: Seed the six marketdata.fmp.* config keys

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/007_marketdata_fmp.up.sql` — create
- `services/xstockstrat-config/migrations/007_marketdata_fmp.down.sql` — create

**Reviewers**: `xstockstrat-config` (service owner) — new `marketdata.fmp.*` keys + the new `marketdata.<source>.enabled` convention, key naming `<service>.<category>.<key>`; Security — `secret.marketdata.fmp.api_key` uses `secret.*` prefix, seeded value is a secret reference (never plaintext).

**Codebase Evidence**:
- Defaults are seeded **only in SQL migrations** (no code constant map) — confirmed by discovery digest; service code (`src/grpc/configServiceImpl.ts`) serves whatever rows exist, so **no `src/` change is needed** to register keys.
- Last config migration on trunk is `005`. To avoid a three-way `006` collision with siblings 058/062 in
  the shared `xstockstrat-config` migrations dir, this feature is pre-assigned **007** (058 keeps
  `006_watchlist_config`, 062 takes `008`; see merge-order.md "Screener config-migration ordering").
  Template = `migrations/005_ingest_backfill_chunking.up.sql:5-26` (and `.down.sql:4-10`).
- Insert columns + 4-column conflict target: `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)` with `ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING` — confirmed via `002_config_environment.up.sql:20-21` UNIQUE constraint; keys are seeded **twice** (`'dev','all'` and `'production','all'`).
- `is_secret` column exists (`001_config_tables.up.sql:12`, default FALSE) but **no existing seed sets it TRUE** — `secret.marketdata.fmp.api_key` is the first; the INSERT column list must add `is_secret` and the value must be a secret reference, never the real key (CLAUDE.md:32 invariant).
- `value_type` CHECK set is `'string'|'int'|'float'|'bool'|'json'` (`001_config_tables.up.sql`). Existing `marketdata.*` example: `002_config_environment.up.sql:65-67`.

**Instructions**:
1. Create `007_marketdata_fmp.up.sql` following the migration-005 template. Seed each of the six keys **twice** (once `environment='dev', trading_mode='all'`, once `environment='production', trading_mode='all'`), `consuming_service='xstockstrat-marketdata'`, with these `value_type`/`value_data` defaults (from product-spec Config Key Changes):
   - `marketdata.fmp.enabled` → `bool`, `'false'`
   - `secret.marketdata.fmp.api_key` → `string`, `is_secret=TRUE`, `value_data` = a secret reference placeholder (e.g. `'secret://marketdata/fmp-api-key'`), **never** a real key
   - `marketdata.fmp.cache_ttl_hours` → `int`, `'24'`
   - `marketdata.fmp.daily_request_cap` → `int`, `'250'`
   - `marketdata.fmp.base_url` → `string`, `'https://financialmodelingprep.com'`
   - `marketdata.fmp.metrics` → `string`, `'core,extended'`
   For the secret row, extend the INSERT column list to include `is_secret` (the other five rows can omit it and rely on the FALSE default, or set it explicitly to FALSE for clarity).
   Use `ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING`.
2. Create `007_marketdata_fmp.down.sql` following `005_ingest_backfill_chunking.down.sql`'s `DELETE FROM config.config_values WHERE namespace='marketdata' AND key IN (...)` pattern — list all six keys (note `secret.marketdata.fmp.api_key`'s namespace is still `marketdata`; confirm namespace/key split matches how the row is seeded in the up migration, then mirror it exactly).
3. Do not edit `configServiceImpl.ts` — serving is data-driven.

**Verification**: covered by Step 10. Manual:
```bash
ls services/xstockstrat-config/migrations/ | sort   # confirm 007_marketdata_fmp.{up,down}.sql present
```

---

### Step 6 — service: FMP client behind a new FundamentalsSource interface

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/source/source.go` — modify (add `FundamentalsSource` interface only; do **not** touch `DataSourceClient`)
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — create
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (construct + register the FMP client)

**Reviewers**: `xstockstrat-marketdata` (service owner) — source-registry integrity (Alpaca path untouched), quota/fetch correctness, hybrid endpoint strategy.

**Codebase Evidence**:
- `DataSourceClient` interface at `internal/source/source.go:14-20`; optional-capability pattern `MultiSymbolSource` at `source.go:26-29` (type-asserted, not required of every provider) — the model for adding `FundamentalsSource` *alongside* without changing `DataSourceClient`.
- `Registry` at `source.go:33-60` (`NewRegistry`, `Register(name, client)`, `Get(name)`). FR-2 says the existing registry stays untouched, so the FMP client is held as its own field (not registered under the OHLCV `Registry`) — see Step 8 wiring.
- Alpaca client (the untouched reference) at `internal/alpaca/client.go` (`NewClient` :65, auth header `APCA-API-KEY-ID` :86, REST bars/quotes). New FMP code is a **separate** `internal/fmp/` package — confirmed absent today (discovery: no `internal/fmp/`).
- main.go wiring points: config load `main.go:48`; watcher `main.go:51`; Alpaca client `main.go:62`; registry `main.go:103-104`; service construction `main.go:106` `service.NewMarketDataService(reg, repo, cfgWatcher, cfg.LedgerEndpoint, cfg.NotifyEndpoint)`.
- Config accessors on `*config.Watcher` (`internal/config/config.go`): `GetString(key, default)` :94, `GetInt` :108, `GetBool` :136. FMP reads: `marketdata.fmp.enabled` (GetBool), `secret.marketdata.fmp.api_key`/`marketdata.fmp.base_url`/`marketdata.fmp.metrics` (GetString), `marketdata.fmp.cache_ttl_hours`/`marketdata.fmp.daily_request_cap` (GetInt).
- FMP endpoint paths (resolving OQ-059-a-impl per context.md): hybrid strategy (FR-5) — core metrics via the **batchable** `quote` endpoint (1 call per scan chunk → `market_cap`, `pe`, `eps`, `price`, 52-week range); extended metrics via per-symbol `ratios-ttm` + `profile` (`pb_ratio`, `dividend_yield`, `roe`, `beta`, `debt_to_equity`). Base URL is config-driven; build paths under it (e.g. `/stable/quote`, `/stable/ratios-ttm`, `/stable/profile` per context.md). **Avoid** the gated `profile-bulk` endpoint.

**Instructions**:
1. In `internal/source/source.go`, **append** a new interface (do not modify `DataSourceClient` at L14-20):
   ```go
   // FundamentalsSource fetches fundamental metrics for symbols (FMP-backed).
   // Separate from DataSourceClient (OHLCV-shaped) — FR-2: the Alpaca/OHLCV path is untouched.
   type FundamentalsSource interface {
       GetFundamentals(ctx context.Context, symbol string) (*Fundamentals, error)
       GetFundamentalsMulti(ctx context.Context, symbols []string) ([]*Fundamentals, error)
   }
   ```
   Define a plain-Go `Fundamentals` struct in this package (typed core fields + an `ExtraMetrics map[string]float64`, `AsOf time.Time`, `Currency`, `Source`) so the FMP package and repo do not depend on generated proto types. (If a shared internal model already lives elsewhere, reuse it; discovery found none — create it here.)
2. Create `internal/fmp/fmp_client.go` implementing `source.FundamentalsSource`:
   - A `NewClient(cfg ClientConfig)` constructor taking `baseURL`, `apiKey`, an `*http.Client`, and the metrics allowlist (`core`/`extended`), mirroring the `alpaca.NewClient(alpaca.ClientConfig{...})` shape at `alpaca/client.go:65`.
   - `GetFundamentalsMulti`: one batched `quote` call for core metrics across the symbol chunk; when the metrics allowlist includes `extended`, augment per-symbol via `ratios-ttm` + `profile`. Map response fields to the `source.Fundamentals` struct; put unmapped FMP fields into `ExtraMetrics`.
   - `GetFundamentals`: single-symbol path (may delegate to `GetFundamentalsMulti` with a 1-element slice).
   - Use the config-supplied base URL; do **not** hardcode the host. Never log the API key.
   - The HTTP transport must be injectable (a `*http.Client` field) so tests can assert call counts (acceptance criterion 2 + 5).
3. In `cmd/server/main.go`, after the config watcher is ready (`main.go:51-56`) and near the Alpaca client construction (`main.go:62`), construct the FMP client **only when** `cfgWatcher.GetBool("marketdata.fmp.enabled", false)` is true; read `secret.marketdata.fmp.api_key`, `marketdata.fmp.base_url`, `marketdata.fmp.metrics` via `GetString`. Pass the FMP client (or nil when disabled) into `service.NewMarketDataService(...)` — extend that constructor signature in Step 8. Do **not** call `reg.Register(...)` for FMP (the OHLCV registry stays Alpaca-only, FR-2).

**Verification**: lint + behavior covered by Step 9. Source-integrity check:
```bash
git diff services/xstockstrat-marketdata/internal/source/source.go | grep -A6 "DataSourceClient interface"   # confirm no change to the existing interface
git diff services/xstockstrat-marketdata/internal/alpaca/   # must be empty — FR-2 (Alpaca untouched)
```

---

### Step 7 — service: Repository read-through cache + daily quota-count methods

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go` — modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — cache correctness, quota count over `fetched_at`, upsert idempotency.

**Codebase Evidence**:
- Repo is raw pgx over `pgxpool` (no sqlc): `NewMarketDataRepo` :20, `InsertBars` :32 (upsert `ON CONFLICT`), `QueryBars` :69, `GetLatestQuote` :209 (discovery digest). New methods follow the same raw-SQL style and reuse the existing pool (no new pool — DB budget stays 2, root CLAUDE.md § Connection Pool Budget).
- Target table `marketdata.fundamentals` from Step 3; quota is `COUNT(*)` over `fetched_at` within the UTC-day window (FR-4) — index `idx_fundamentals_fetched_at` from Step 3 supports it.

**Instructions**:
1. Add `GetFundamentals(ctx, symbol) (*Fundamentals, fetchedAt time.Time, found bool, err error)` reading one row from `marketdata.fundamentals` by `symbol` (PK lookup). Return `found=false` on no row.
2. Add `UpsertFundamentals(ctx, f *Fundamentals) error` — `INSERT ... ON CONFLICT (symbol) DO UPDATE SET ...` writing all typed columns + `extra_metrics` (jsonb) + `as_of`/`currency`/`source` and refreshing `fetched_at = now()`, mirroring the `InsertBars` upsert idiom at `marketdata_repo.go:32`.
3. Add `CountFundamentalsFetchedToday(ctx) (int, error)` — `SELECT count(*) FROM marketdata.fundamentals WHERE fetched_at >= date_trunc('day', now() AT TIME ZONE 'UTC')` (FR-4 day-window quota count; no separate counter table — resolved decision OQ-059-d).
4. Reuse the existing `*pgxpool.Pool` held by the repo — do not open a second pool.

**Verification**: covered by Step 9.

---

### Step 8 — service: GetFundamentals(Multi) RPC — cache → quota guard → FMP → alert

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify (Connect handler methods + `grpcMarketDataAdapter` methods)

**Reviewers**: `xstockstrat-marketdata` (service owner) — read-through cache correctness, quota guard (stale-vs-ResourceExhausted), disabled-default gate, 80% WARNING alert, header propagation on the notify call.

**Codebase Evidence**:
- Service impl `internal/service/marketdata_service.go`; constructor `NewMarketDataService(reg, repo, cfgWatcher, ledgerEndpoint, notifyEndpoint)` at `main.go:106`. DB-as-cache idiom to mirror: `GetBars` DB-miss → `fetchAndCacheBars` (`marketdata_service.go:132-147`); `GetLatestQuote` read-then-fetch (`:324-341`).
- Existing RPC plumbing pattern per method: service method + Connect handler method + `grpcMarketDataAdapter` method. Examples: `GetLatestQuote` handler.go:98 / adapter:179 / svc:320; `GetBars` handler.go:86 / adapter:171 / svc:77. Adapter signature: `func (a *grpcMarketDataAdapter) Method(ctx context.Context, req *marketdatav1.XReq) (*marketdatav1.XResp, error)`.
- Notify client already wired: `marketdata_service.go:69` `notify: notifyv1.NewNotifyServiceClient(notifyConn)`; existing `emitAlert` at `:761` calls `s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{...})`. For FR-7 use `notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING`. **No new endpoint** needed.
- Header propagation: outbound gRPC dials use `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)` (`marketdata_service.go:56,60`); `internal/middleware/propagation.go` `UnaryClientInterceptor` :39 injects `x-user-id`/`x-access-scope`/`x-trace-id`. The notify alert reuses the already-propagating `notify` client — no extra header wiring required, but the alert must be emitted with the request `ctx` so the interceptor carries the headers.
- Config accessors: `GetBool`/`GetInt`/`GetString` on `*config.Watcher` (`config.go:94,108,136`); runtime reads in the service are already done elsewhere (`marketdata_service.go:301,360,483`).

**Instructions**:
1. Extend `NewMarketDataService(...)` (the constructor at `main.go:106`) to accept the `source.FundamentalsSource` built in Step 6 (or nil when disabled) and store it on the service struct. Update the `main.go:106` call site accordingly.
2. Add a service method `GetFundamentals(ctx, symbol)` implementing the orchestration (mirroring the `GetBars`/`fetchAndCacheBars` read-through idiom):
   - **Disabled gate (FR-6 / acceptance #4)**: if `cfg.GetBool("marketdata.fmp.enabled", false)` is false (or the FMP client is nil), return gRPC `FailedPrecondition` (or `Unavailable`) and make **no** external call.
   - **Cache hit (FR-3 / acceptance #1,2)**: `repo.GetFundamentals(ctx, symbol)`; if found and `fetched_at` is within `cfg.GetInt("marketdata.fmp.cache_ttl_hours", 24)` hours, return it with `stale=false` and issue **no** FMP HTTP request.
   - **Quota guard (FR-4 / acceptance #3)**: on miss/stale, before fetching call `repo.CountFundamentalsFetchedToday(ctx)`; if `count >= cfg.GetInt("marketdata.fmp.daily_request_cap", 250)`, then: if a stale cache row exists, return it with `stale=true`; else return gRPC `ResourceExhausted`. Never return a fabricated zero-metric response.
   - **Fetch + upsert**: otherwise call the FMP client's `GetFundamentals`, `repo.UpsertFundamentals(...)`, and return the fresh row with `stale=false`.
   - **80% warning alert (FR-7)**: after a successful fetch, if the post-fetch daily count crosses ~80% of the cap, emit a `notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING` alert via the existing `notify` client using the request `ctx` (so propagation interceptor carries the headers). Guard against duplicate spam (only alert on the crossing).
3. Add `GetFundamentalsMulti(ctx, symbols)` — batched path (FR-5 / acceptance #5): partition symbols into cached-fresh vs needs-fetch; for the needs-fetch set, call the FMP client's `GetFundamentalsMulti` so core metrics cost ~1 `quote` call per chunk; upsert each; assemble the response preserving requested order.
4. Map the internal `source.Fundamentals` struct to the generated `marketdatav1.Fundamentals` message (set `source="fmp"`, `stale`, `as_of`, `extra_metrics`).
5. Add the Connect handler methods and the `grpcMarketDataAdapter` methods for both RPCs in `internal/handler/marketdata_handler.go`, following the `GetLatestQuote` precedent (handler.go:98 / adapter:179).

**Verification**: covered by Step 9. Header-propagation check:
```bash
grep -n "UnaryClientInterceptor\|EmitAlert" services/xstockstrat-marketdata/internal/service/marketdata_service.go
```
Confirm the new WARNING `EmitAlert` call passes the request `ctx` and the notify client was dialed with `middleware.UnaryClientInterceptor` (reuses the propagating client — no separate header wiring).

---

### Step 9 — test: FMP client + repo + service RPC (mocked transport, quota, disabled gate)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — create
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — create or modify

**Reviewers**: `xstockstrat-marketdata` (service owner) — covers cache hit/miss, quota exhaustion, disabled gate, batch call-count.

**Codebase Evidence**:
- Marketdata is a Go service → CI coverage threshold **40%** with the excluded-package coverpkg formula (spec-template coverage table). Note: service/handler/repository/cmd packages are in the CI-excluded set; the FMP client lives in `internal/fmp/` (not excluded) and carries the testable mapping/quota logic.
- Existing test entrypoint `cmd/server/main_test.go` confirms Go `testing` is in use.
- FMP client's HTTP transport is injectable (Step 6) → tests assert call counts via a mock `http.RoundTripper` (acceptance #2, #5).

**Instructions**:
1. `fmp_client_test.go`: use a stub `http.RoundTripper`/`httptest.Server` to assert: (a) `GetFundamentals` maps core + extended fields correctly into the struct and `ExtraMetrics`; (b) `GetFundamentalsMulti` over N symbols issues exactly **one** `quote` request for core metrics (acceptance #5); (c) the API key is never present in any logged output.
2. Service tests with a fake `FundamentalsSource` (call-counting) and an in-memory/stub repo: assert (a) a second within-TTL call issues **zero** FMP calls (acceptance #2); (b) at-cap miss with stale cache → `stale=true`; at-cap miss with no cache → `ResourceExhausted` (acceptance #3); (c) `enabled=false` → `FailedPrecondition`/`Unavailable` with zero FMP calls and Alpaca path unaffected (acceptance #4); (d) the 80%-cap crossing emits exactly one WARNING `EmitAlert`.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm lint clean and total coverage ≥ 40%. (New mapping/quota logic in `internal/fmp/` is in a measured package; service/repo logic lives in CI-excluded packages — the `internal/fmp/` coverage plus the existing suite must keep total ≥ 40%.)

---

### Step 10 — test: Verify config 006 seed migration up/down + key serving

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- (no new files — exercises `007_marketdata_fmp.{up,down}.sql` + existing config test suite)

**Reviewers**: `xstockstrat-config` (service owner) — keys seeded in both dev+prod scopes, secret flag set, down removes all six.

**Codebase Evidence**:
- Config service coverage threshold **40%** via `pnpm run test:coverage` (`package.json:14` `c8 ... --lines 40`); lint `pnpm run lint` (`package.json:13`). Migrations run via `pnpm run migrate` (`package.json:11`, `node-pg-migrate up`).
- Seed lives entirely in SQL (Step 5) — no `src/` logic change, so this step validates migration application + that `getConfig`/`listKeys` serve the new rows (serving logic `configServiceImpl.ts:232,276`).

**Instructions**:
1. Apply config migrations through `007`, then confirm `GetConfig(namespace="marketdata")` returns the six new keys (with `marketdata.fmp.enabled=false`, `marketdata.fmp.daily_request_cap=250`, etc.) and that the secret key is flagged `is_secret=true` with a secret-reference value (not plaintext).
2. Roll `007` down and confirm all six rows are removed; roll back up to confirm reversibility.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint
cd services/xstockstrat-config && pnpm run test:coverage   # confirm ≥ 40% lines threshold passes
# migration round-trip:
cd services/xstockstrat-config && pnpm run migrate         # applies through 006
```
Confirm lint clean, coverage threshold passes, and the six `marketdata.fmp.*` rows are present after `up`.

---

### Step 11 — docs: Document marketdata.fmp.* keys in marketdata CLAUDE.md

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify

**Reviewers**: none.

**Codebase Evidence**:
- `services/xstockstrat-marketdata/CLAUDE.md` has a "Config Keys Consumed" table at `CLAUDE.md:44` (header) / `:48` (table head), listing existing `marketdata.alpaca.*` and `marketdata.stream.*` keys (`:51,52,58`). Root CLAUDE.md § Config Governance Rules requires defaults be declared in each service's CLAUDE.md.
- Root CLAUDE.md already lists `marketdata.alpaca.adjustment` under "Recently added keys" — the new `marketdata.fmp.*` keys + the `marketdata.<source>.enabled` convention should likewise be added to the root governance table (per config-rollout.md Pre-Rollout Checklist: "open a PR to root CLAUDE.md to document the key").

**Instructions**:
1. Add the six `marketdata.fmp.*` keys (incl. `secret.marketdata.fmp.api_key`) with their types, defaults, and descriptions to the "Config Keys Consumed" table in `services/xstockstrat-marketdata/CLAUDE.md` (after `:58`), matching the existing row format.
2. Add a "Recently added keys (feature 059 — fundamentals data source)" block to the root `CLAUDE.md` § Config Governance Rules, documenting the six keys and noting the new `marketdata.<source>.enabled` convention (FR-6).
3. Note in the marketdata CLAUDE.md that FMP is a **separate `FundamentalsSource`** (FR-2) and does not affect the Alpaca OHLCV path.

**Verification**:
```bash
grep -n "marketdata.fmp" services/xstockstrat-marketdata/CLAUDE.md CLAUDE.md
```
Confirm all six keys appear in both the service CLAUDE.md config table and the root governance table.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
