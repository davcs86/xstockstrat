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
