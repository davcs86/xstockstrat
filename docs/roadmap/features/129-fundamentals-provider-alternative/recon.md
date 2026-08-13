# Recon: fundamentals-provider-alternative

**Created**: 2026-08-12
**From**: product-spec.md
**Affected services**: `xstockstrat-marketdata`, `xstockstrat-config`

---

## Objective

Replace (or add as a switchable alternative behind the existing `source.FundamentalsSource`
interface) the FMP fundamentals client in `xstockstrat-marketdata` with a provider that clears
FMP's free-tier ceiling (250 req/day + per-symbol-throttled `ratios-ttm`/`profile` endpoints) while
covering the same field set: price, market cap, P/E, EPS, 52w high/low, P/B, dividend yield, ROE,
debt-to-equity, beta, currency. Grilling must pick between Finnhub and Twelve Data against their
**live, current API docs** — not assumption — and the RPC/proto contract stays unchanged throughout.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Entry point / construction: `cmd/server/main.go:175-189` (`newFundamentalsSource` builds
    `fmp.NewClient`), held as a dedicated field and passed to `NewMarketDataService`
    (`main.go:104-112`) — **never** passed to `reg.Register(...)` (that's the OHLCV-only
    `alpaca` registration at `main.go:105`)
  - Provider client: `internal/fmp/fmp_client.go` — `ClientConfig`/`Client` (`:21-38`), `NewClient`
    (`:41-58`), `GetFundamentals` (`:63-72`, delegates to Multi), `GetFundamentalsMulti`
    (`:76-115`, 1 batched `quote` call + optional per-symbol `ratios-ttm`+`profile`), HTTP plumbing
    `getJSON` (`:121-148`, apikey never logged, error strips URL), per-endpoint fetchers
    `fetchQuotes`/`fetchRatios`/`fetchProfile` (`:150-184`), response structs + `apply()`/
    `toFundamentals()` mappers (`:189-250`)
  - Provider-agnostic contract: `internal/source/source.go` — `source.Fundamentals` struct
    (`:34-51`, every field a new client must populate), `source.FundamentalsSource` interface
    (`:57-60`, `GetFundamentals`/`GetFundamentalsMulti`), `source.Registry` (`:64-91`, OHLCV-only —
    fundamentals providers stay out of it)
  - Handler/servicer: `internal/service/marketdata_service.go` — service fields
    (`:48-59`), `fundamentalsConfig`/`fundamentalsRepo` interfaces (`:62-73`),
    `GetFundamentals` RPC (`:846-858`), `GetFundamentalsMulti` RPC (`:862-922`),
    `resolveFundamentals` cache→quota→fetch (`:926-957`), `fundamentalsEnabled()` live gate
    (`:965-970`), daily-cap check + `ResourceExhausted`/stale-serve (`:936-946` single,
    `:888-899` multi), 80%-cap WARNING dedup (`maybeAlertQuota` `:974-987`, `emitWarning`
    `:989-1002`), `toProtoFundamentals` mapper (`:1005-1034`)
  - Last migration: `003_canonicalize_ohlcv_timeframe` (`migrations/`); fundamentals cache table
    is `002_fundamentals.up.sql:7-25` (plain table, PK `symbol`) / `.down.sql:5-6`
  - Config-read pattern: live-per-call (`enabled`, `cache_ttl_hours`, `daily_request_cap`) at
    `marketdata_service.go:866,888,927,936,966`; startup-only (`base_url`, `metrics`) at
    `cmd/server/main.go:181-182`
  - Env-var wiring: `internal/config/config.go:29,46-50` (`Config.FMPAPIKey`, deliberately not a
    config-service key); `docker-compose.yml:250-252` (`FMP_API_KEY: ${FMP_API_KEY:-}`);
    `.do/app.dev.yaml:144-147` / `.do/app.yaml:144-147` (`type: SECRET`)
  - Existing tests to mirror: `internal/fmp/fmp_client_test.go` (full file — `recordingRT` fake
    `http.RoundTripper`, field-mapping test, batched-quote-call-count test, key-not-leaked test);
    `internal/service/marketdata_service_test.go:168-424` (fake doubles + 8 acceptance tests:
    cache-hit, at-cap-stale, at-cap-no-cache, disabled, live-toggle, miss-fetch-upsert,
    quota-WARNING-once, nil-source); `internal/config/config_test.go:184-206`
    (`TestLoadFromEnv_FMPAPIKeyComesFromEnv`/`...DefaultsEmpty`); `cmd/server/main_test.go:33-43`
    (`TestNewFundamentalsSource_AlwaysNonNil` — feature 082 boot-time regression canary)
  - Proto contract (read directly for this recon, not by the marketdata discovery pass):
    `packages/proto/marketdata/v1/marketdata.proto:160-196` — `Fundamentals` message (fields
    1-17, including `stale` field 17 for FR-4's semantics), `GetFundamentalsRequest/Response`,
    `GetFundamentalsMultiRequest/Response`. **Comment drift risk**: the message doc-comment reads
    `"cached fundamental metrics for a symbol, FMP-backed"` (`:160`), field 16 `source` has an
    inline comment `// "fmp"` (`:178`), and field 13 `extra_metrics` is commented `"FMP's
    open-ended metric set (keys are FMP field names)"` (`:174`) — all three go stale the moment a
    non-FMP client starts populating this same message. No field/message/RPC shape change is
    needed (confirms product-spec's "no proto changes required"), but these three comments need a
    text-only edit in the same PR that swaps the client, or they actively mislead the next reader.

- **`xstockstrat-config`** (Node.js)
  - Entry point / seed pattern: config keys are **not** validated by a dedicated function — no
    `validate_config` symbol exists anywhere in `src/`. Validation is a Postgres `CHECK
    (value_type IN ('string','int','float','bool','json'))` (`migrations/001_config_tables.up.sql:6-21`)
    plus a runtime existence-gate in `src/grpc/configServiceImpl.ts:346-366` (`SetConfig` on an
    unregistered `(namespace,key,environment,trading_mode)` scope → `NOT_FOUND` unless
    `create_key=true`) — **new keys must be pre-seeded by a migration**, exactly like FMP's were.
  - Direct template to copy: `migrations/007_marketdata_fmp.up.sql:1-64` — 6 keys, each seeded
    twice (`environment` ∈ {dev, production}, `trading_mode='all'`), `ON CONFLICT (namespace,
    key, environment, trading_mode) DO NOTHING`; `.down.sql:5-14` symmetric `DELETE ... WHERE key
    IN (...)`.
  - **Secret-key precedent (do not reintroduce)**: `migrations/009_drop_fmp_api_key_config.up.sql:1-20`
    removed `secret.marketdata.fmp.api_key` from config in favor of `FMP_API_KEY` (feature 076);
    `.down.sql:4-13` restores only a placeholder, explicitly noting it was "never a real
    credential". A new provider's API key follows the same `<PROVIDER>_API_KEY` env-var pattern —
    never a `secret.marketdata.<source>.api_key` config row.
  - Schema/scope columns: `migrations/001_config_tables.up.sql:6-21` (base table + `value_type`
    CHECK), `migrations/002_config_environment.up.sql:6-21` (adds `environment`/`trading_mode`
    CHECK + the `(namespace, key, environment, trading_mode)` unique constraint)
  - Last migration in the service: `014_config_caller_identity` → next free number for a seed
    migration is **015**.
  - Docs to mirror: `docs/patterns/config-governance.md:29-34` (registration steps: seed migration
    → declare in consuming service's CLAUDE.md → owner+config-team approval → Per-Feature
    Registered Keys log row) and `:205-216` (the existing feature-059 `marketdata.fmp.*` log
    section — new entry follows the same table shape, including the struck-through removed-secret
    row pattern).

## Patterns to REUSE

- New provider client (`GetFundamentals`/`GetFundamentalsMulti`, batched core + optional extended
  per-symbol calls) → reuse the exact shape of `internal/fmp/fmp_client.go:21-250` (client struct,
  `getJSON` HTTP plumbing, response-struct-per-endpoint + `apply()`/`toFundamentals()` mapper
  pattern) — implement `source.FundamentalsSource` (`internal/source/source.go:57-60`), never
  touch `source.Registry`.
- Read-through cache / quota guard (`marketdata.fundamentals` table, TTL, daily-cap,
  stale-serve, 80%-WARNING) → reuse `internal/service/marketdata_service.go:846-1002` verbatim;
  the new client only needs to satisfy `fundamentalsConfig`/`fundamentalsRepo` semantics already
  present — no new cache/quota logic to write (matches product-spec FR-4).
  **Known trap** (`docs/roadmap/ledger/fails.md` 2026-08-06, `fundamentals-data-source`): do not
  assume this existing quota-guard/alert code is parameterized for a different limit *shape*
  (e.g. per-minute rate limit instead of a daily cap) without reading it in full first — it is
  read above (`:936-1002`) and is currently daily-cap-shaped only; if the chosen provider's real
  limit is per-minute rather than per-day (an open FR-1 question), this code needs a shape change,
  not just a new constant.
- DB cache schema → reuse `marketdata.fundamentals` (`migrations/002_fundamentals.up.sql:7-25`)
  as-is; confirmed **no column gap** — every `source.Fundamentals` field already has a column
  (verified against `internal/repository/marketdata_repo.go:252-335` read/upsert).
- New config keys → reuse the exact `marketdata.fmp.*` seed-migration pattern
  (`services/xstockstrat-config/migrations/007_marketdata_fmp.up.sql:1-64` /
  `.down.sql:5-14`) at the next free migration number (**015**).
- API credential → reuse the `<PROVIDER>_API_KEY` secret-env-var pattern established by feature
  076 (`internal/config/config.go:29,46-50`, `docker-compose.yml:250-252`,
  `.do/app.dev.yaml:144-147`, `.do/app.yaml:144-147`) — never a config-service secret key
  (`migrations/009_drop_fmp_api_key_config.up.sql`).
- Tests → reuse the fake-`http.RoundTripper` + acceptance-test shape of
  `internal/fmp/fmp_client_test.go` (full file) and the fake-doubles/8-acceptance-test shape of
  `internal/service/marketdata_service_test.go:168-424`, plus the config-load tests in
  `internal/config/config_test.go:184-206` and the boot-canary in
  `cmd/server/main_test.go:33-43`.

## Dependencies

- Proto/RPC: no field/message/RPC shape change (`Fundamentals`, `GetFundamentals(Multi)Request/Response`
  unchanged, `packages/proto/marketdata/v1/marketdata.proto:160-196`) — but 3 doc-comments there
  (`:160`, `:174`, `:178`) name FMP specifically and need a text-only update in the same PR (see
  Codebase Map risk above). A comment-only `.proto` edit still goes through the normal
  `buf lint`/`buf breaking` + `./scripts/buf-gen.sh` steps (root `CLAUDE.md` § Proto Contract
  Governance) even though it changes no wire shape.
- Migration: `services/xstockstrat-config/migrations/` next number **015** (new provider's config
  keys). No `xstockstrat-marketdata` migration expected — `002_fundamentals` schema already covers
  every field (confirmed above); `/sdd-spec` should re-confirm this once the provider is finally
  picked, in case the chosen provider's live docs (FR-1) surface a field FMP doesn't have.
- Config keys: `marketdata.<source>.enabled` / `.base_url` / a request-quota key (shape TBD by
  FR-1) / possibly `.cache_ttl_hours` and `.metrics` — exact set and defaults finalized in
  design.md once the provider is chosen; `marketdata.fundamentals.provider` selector only if FR-6
  resolves to switchable-not-replaced.
- Inter-service edges: none new — `xstockstrat-analysis` continues to read fundamentals only via
  `xstockstrat-marketdata`'s `GetFundamentals`/`GetFundamentalsMulti` RPCs (unchanged chokepoint,
  product-spec FR-7).
- New env vars / ports: `<PROVIDER>_API_KEY` (exact name depends on the FR-2 pick, e.g.
  `FINNHUB_API_KEY` or `TWELVEDATA_API_KEY`) — confirmed **absent** from `docker-compose.yml`,
  `.do/app.dev.yaml`, `.do/app.yaml` today (only `FMP_API_KEY` is present at the cited lines); must
  be added to all three as `type: SECRET` in `/sdd-spec`. No new port.

## Risks / Not-found

- **Design-owned, not a recon gap**: FR-1/FR-2 (which provider, Finnhub or Twelve Data) is
  explicitly out of scope for codebase discovery — both recon subagents correctly declined to
  evaluate the providers themselves. This is the grilling phase's job, verified against each
  candidate's live API docs, not recon's.
- No existing convention in `xstockstrat-marketdata` for registering **multiple named**
  fundamentals providers side-by-side (unlike the OHLCV `source.Registry`'s named-slug pattern —
  `fundamentals` is a single, unnamed service field today). If design (FR-6) chooses
  "switchable, not replaced," this is new ground, not a reuse — flag as a design decision, not an
  assumption.
- `internal/repository/marketdata_repo_test.go` was not surveyed for fundamentals-specific
  repo-layer test cases (the discovery pass only covered `fmp_client_test.go`,
  `marketdata_service_test.go`, `config_test.go`, `main_test.go`) — re-check at `/sdd-spec` time
  if a repo-layer test step is planned.
- `docs/patterns/config-governance.md`'s global rule 6 ("Sensitive keys use the `secret.*` prefix
  … resolved from the secret store at runtime") is **aspirational and superseded in practice** for
  API-key-style credentials by feature 076/migration 009 — the config-service recon flagged this
  explicitly. Design must follow the *actual* precedent (env var), not the doc's stated rule,
  which is itself stale (candidate for a future `/context-scrubber` pass on that doc, out of scope
  here).
- Known trap (`docs/roadmap/ledger/fails.md` 2026-08-06, `fundamentals-data-source`): see Patterns
  to REUSE above — carried forward as a design constraint, not re-stated as new.
- Known trap (`docs/roadmap/ledger/fails.md` 2026-07-30, `082-fix-fmp-config-boot-only`): branch
  divergence between a harness-assigned branch and a separately-created SDD branch. Already
  resolved for this feature by pinning `**Development Branch**` to the harness branch
  (`context.md` § Session sdd-story).

## Recommended Scope

Advisory only — `/sdd-spec` decides the real step boundaries once design.md picks a provider:

1. **config**: seed migration `015_marketdata_<source>.up/down.sql` (new keys) — paired with a
   `config` step registering them in `docs/patterns/config-governance.md` and
   `services/xstockstrat-marketdata/CLAUDE.md`.
2. **service**: new `internal/<source>/` client package (mirrors `internal/fmp/`) — paired `test`
   step mirroring `fmp_client_test.go`.
3. **service**: wire the new client into `cmd/server/main.go` (`newFundamentalsSource` or a
   sibling constructor) + env var (`<PROVIDER>_API_KEY`) in `docker-compose.yml`/`.do/app*.yaml`.
4. **service**: if FR-6 resolves to full replacement — remove `internal/fmp/`, its registration,
   `marketdata.fmp.*` config keys (a `xstockstrat-config` down-style migration), and the 3 proto
   doc-comments' FMP wording; if switchable — add the `marketdata.fundamentals.provider` selector
   and a small dispatch in the constructor. This decision point is exactly FR-6 / design.md's job.
5. **docs**: update `services/xstockstrat-marketdata/CLAUDE.md` § FMP Fundamentals Integration
   (rename/generalize the section) and `docs/patterns/config-governance.md`'s Per-Feature
   Registered Keys log (new entry after the feature-059 section).
6. **test**: acceptance tests mirroring the 8 cases in `marketdata_service_test.go:272-424`
   against the new provider's fake source — cache-hit, at-cap-stale, at-cap-exhausted, disabled,
   live-toggle, miss-fetch-upsert, quota-WARNING-once, nil-source.
