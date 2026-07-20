# Context: fundamentals-data-source

**Feature**: `docs/roadmap/features/059-fundamentals-data-source/feature.md`
**Product Spec**: `docs/roadmap/features/059-fundamentals-data-source/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/059-fundamentals-data-source/implementation-spec.md`

---

## Session 2026-06-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md. Feature 2 of 6.
- **Single FMP chokepoint**: 060 (screener) and 062 (producer) read fundamentals ONLY via this
  service's cached `GetFundamentals*` RPC, so the 250/day budget is enforced in exactly one place.
- Design evidence: `BackfillBarsRequest` has no `source` field (verified) → a dedicated fundamentals
  RPC is required, not source-routing. The FMP `DataSourceClient` interface is OHLCV-shaped → a
  separate `FundamentalsSource` interface is used instead. No existing caching layer in marketdata →
  cache built from scratch as a DB table (the repo's DB-as-cache idiom).
- User decisions (this session): metric set = Core + extended ratios; license = Personal/paper, start
  on free Basic; commercial use later ⇒ revisit FMP plan. FMP free Basic confirmed: 250 calls/day, EOD
  historical, profile + reference, batch `quote` supported.

## Session 2026-06-26 — sdd-review product-spec

- Product spec reviewed (spec-reviewer + feature-overlap subagents). Status: draft → spec-ready.
- Verdict: PASS / overlap CLEAN. All code-checkable claims verified: marketdata migrations run 000–001
  so `002_fundamentals` is next free; `BackfillBarsRequest` has no `source` field; config keys follow
  `<service>.<category>.<key>` with correct `secret.*` prefix on the API key; DB pool budget unchanged.
- Warning (non-blocking): OQ-059-a-impl — exact FMP endpoint paths (`/stable/quote`, `/stable/ratios-ttm`,
  `/stable/profile`) and canonical field mapping remain deferred to /sdd-spec. Reviewer judged this a
  correctly-scoped implementation detail (the product-level metric-set decision OQ-059-a is resolved),
  NOT a product-spec gap. Gate passes; resolve the endpoint paths during /sdd-spec.
- Overlap findings: none. `marketdata.fmp.*` / `secret.marketdata.fmp.api_key` keys, the `002_fundamentals`
  migration, and the new `Fundamentals` message/RPCs are uniquely owned by 059. Siblings 060/062/063 are
  documented downstream consumers of the cached RPC (the single FMP chokepoint), not co-definers.

## Session 2026-06-27 — sdd-spec

- Generated implementation-spec.md with 11 steps. Status: spec-ready → implementation-ready.
- Key codebase findings:
  - **Proto**: `marketdata.proto` last RPC is `ListAssets` (L35); `BackfillBarsRequest` (L95-102) confirmed to have no `source` field. New RPCs/messages are purely additive (append after L35 / after L152). `Bar`/`Quote` use `string source` — `Fundamentals` mirrors that.
  - **Marketdata migrations**: last NNN = `001` → new `002_fundamentals.{up,down}.sql`. Schema `marketdata` already exists (000+001). Plain table (not hypertable). Repo is raw pgx over pgxpool (`marketdata_repo.go`); DB-as-cache idiom to mirror is `GetBars`→`fetchAndCacheBars` (`marketdata_service.go:132-147`).
  - **FR-2 invariant**: `DataSourceClient` interface lives at `source.go:14-20`, Alpaca at `internal/alpaca/`. New `FundamentalsSource` interface is APPENDED to `source.go`; FMP client is a NEW `internal/fmp/` package; neither touches the existing interface or Alpaca. FMP is NOT registered in the OHLCV `source.Registry` (held as its own service field).
  - **Notify already wired**: `marketdata_service.go:69` has a `notify` client + `emitAlert` at :761; FR-7 WARNING reuses it with `ALERT_SEVERITY_WARNING` and the request ctx (propagation interceptor at `middleware/propagation.go:39` carries the 3 headers). No new endpoint env var needed — base_url/api_key are config keys.
  - **Config keys = SQL seed migrations only** (no code constant map). Last config migration = `005` → new `006_marketdata_fmp.{up,down}.sql`. Template = `005_ingest_backfill_chunking.up.sql`; seed each key twice (dev+prod), 4-column `ON CONFLICT (namespace,key,environment,trading_mode)`. `secret.marketdata.fmp.api_key` is the FIRST seeded secret — must add `is_secret=TRUE` to the INSERT and use a secret-reference value, never plaintext. No `src/` change needed (serving is data-driven).
  - **OQ-059-a-impl resolved**: hybrid FMP fetch — batchable `quote` for core metrics (1 call/chunk), per-symbol `ratios-ttm` + `profile` for extended; paths built under config `marketdata.fmp.base_url` (`/stable/quote`, `/stable/ratios-ttm`, `/stable/profile`); avoid gated `profile-bulk`.
  - **Deploy env**: marketdata block in docker-compose.yml:233-264 / .do/app.dev.yaml:103-136 / .do/app.yaml:103-136 already wires CONFIG/LEDGER/NOTIFY/DATABASE_URL + DB_POOL_MAX=2; no new env vars/ports introduced by this feature.

## Session 2026-06-27 — sdd-review impl-spec (advisory)

- Impl-spec reviewed. Verdict: PASS WITH WARNINGS, 0 blockers. All cited symbols verified (source.go DataSourceClient/
  Registry untouched, alpaca do() pattern, service-layer read-through idiom, config Watcher accessors, httptest test
  pattern; FMP endpoint paths /stable/quote|ratios-ttm|profile concrete; secret.marketdata.fmp.api_key is first seeded
  secret w/ is_secret=TRUE + secret-reference value).
- KEY ADVISORY for execute: Step 8 — the existing emitAlert helper (marketdata_service.go:761) HARDCODES
  ALERT_SEVERITY_ERROR and takes only (ctx,msg). FR-7's 80%-quota alert needs ALERT_SEVERITY_WARNING — add a new
  WARNING-capable emit (or parameterize emitAlert by severity); do NOT silently reuse the ERROR-only helper.
- CONFIG-MIGRATION RENUMBER (user-approved): config seed migration renumbered 006 → `007_marketdata_fmp` to resolve the
  three-way config-006 collision (058=006, 059=007, 062=008). Must merge AFTER 058's 006 (golang-migrate numeric order).
  All impl-spec references updated; recorded in merge-order.md.

## Session 2026-06-29 — sdd-execute (all 11 steps)

Executed all 11 steps on `feature/fundamentals-data-source` (stacked on `feature/watchlist-management`,
058). One integration PR per feature (not per-step). Verifications run locally.

- **Step 1–2 (proto + gen)**: `GetFundamentals`/`GetFundamentalsMulti` RPCs + `Fundamentals` message
  added to marketdata.proto. `buf lint`/`buf breaking` clean; `buf-gen.sh` regenerates only the
  marketdata stubs (the WKT timestamp refresh already landed in 058's ancestry).
- **Step 3–4 (marketdata 002 migration)**: `002_fundamentals.{up,down}.sql` (plain table + fetched_at
  index). Applied + rolled back on local Postgres 16 (`\d marketdata.fundamentals` confirmed).
- **Step 5/10 (config 007 migration)**: `007_marketdata_fmp.{up,down}.sql` — 6 keys × dev/prod (12
  rows). Applied + rolled back on local Postgres; the secret row is `is_secret=TRUE` with a
  `secret://` reference. **KEY DECISION (deviation)**: the `key` column carries the FULL dotted key
  the service reads (`marketdata.fmp.enabled`, `secret.marketdata.fmp.api_key`, …) under
  namespace `marketdata`, because the config WatchConfig snapshot is keyed by the `key` column with
  NO namespace prefix added (verified in configServiceImpl.ts) — a bare relative key would never
  resolve at runtime, so the FMP enable/API-key would be dead. See Deviation Log.
- **Step 6 (FMP client)**: new `internal/fmp/` package implementing `source.FundamentalsSource`
  (appended to source.go, `DataSourceClient`/Alpaca untouched — FR-2). Hybrid fetch: one batchable
  `/stable/quote` per chunk + per-symbol `/stable/ratios-ttm` + `/stable/profile` when `extended`.
  Injectable `*http.Client`; API key sent as query param, never logged. Held as a dedicated service
  field, NOT registered in the OHLCV registry. main.go builds it only when `marketdata.fmp.enabled`.
- **Step 7 (repo)**: `GetFundamentals`/`UpsertFundamentals`/`CountFundamentalsFetchedToday` on the
  existing pool (no second pool). Columns verified to match the 002 migration.
- **Step 8 (service + handler)**: read-through cache → quota guard → FMP fetch → 80% WARNING. NEW
  `emitWarning` helper (the existing `emitAlert` hardcodes ERROR — per the impl-spec advisory). New
  gRPC codes mapped in `toGRPCError` (FailedPrecondition/ResourceExhausted/Unavailable). The
  fundamentals config + repo were put behind small interfaces (`fundamentalsConfig`/`fundamentalsRepo`)
  on the service so the cache/quota/gate logic is unit-testable with stubs (the `*config.Watcher`
  snapshot can't be injected from the service test package).
- **Step 9 (tests)**: `internal/fmp/fmp_client_test.go` (core+extended mapping, 1 quote call for N
  symbols, api key never leaked in errors) + fundamentals tests appended to
  `internal/service/marketdata_service_test.go` (cache-hit no-FMP, at-cap stale, at-cap
  ResourceExhausted, disabled FailedPrecondition, miss fetch+upsert, single WARNING). Lint clean,
  total coverage 56.9% (≥40%).
- **Step 11 (docs)**: 6 `marketdata.fmp.*` keys + an FMP integration section in marketdata CLAUDE.md;
  feature-059 block + `marketdata.<source>.enabled` convention note in root CLAUDE.md.

**Stopped at**: all complete → integration PR → `feature/watchlist-management` (058).

## Session 2026-06-29 (CI: feature status automation)

- Promotion PR #729 merged to main
- Feature promoted and committed: e8742e4e4f4dd88cbbc6ed85151784c4434d4885
- Status updated: `code-completed` → `launched`
- Launched date: 2026-06-29
