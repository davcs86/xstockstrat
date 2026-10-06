# Implementation Spec: sector-classification-strategy-params

**Status**: `done`
**Created**: 2026-09-27
**Feature**: `docs/roadmap/features/217-sector-classification-strategy-params/feature.md`
**Total Steps**: 18
**Feature Branch**: `feature/sector-classification-strategy-params`

---

## Execution Summary

The work ships in one feature but is ordered **Group A (classification store) before Group B
(per-sector params)** because Group B's as-of resolution depends on Group A's `GetSectorHistory`
RPC (FR-5). Order:

1. **Proto first** (Step 1–2): the shared `Sector` enum lands in `common/v1/common.proto`, the
   marketdata classification RPCs/messages, and `StrategyDefinition` field 15; stubs regenerate.
2. **Group A / marketdata** (Steps 3–10): migration 007 SCD-2 table → the single-throttle FMP
   gateway → `ClassificationRepo` + the refresh/seed job → RPC wiring → config-key registration.
3. **Group B / analysis** (Steps 11–12): one batched `GetSectorHistory` per symbol per backtest,
   compute-K-distinct-param-variants stitched per bar, default-bucket fallback, `ManageStrategy`
   validation + fingerprint fold, seed-span warning.
4. **Consumer surfaces (C-14)** (Steps 13–16): the **Agent** `manage_strategy` per-sector arg +
   `run_backtest` warning passthrough (+ six inventory surfaces + strat-lab skill), and the **UI**
   `/insights` per-sector authoring + `Sector` exhaustive-`Record` fan-out + sector-resolved
   backtest display.
5. **Business-rule promotion** (Step 17–18): the new marketdata acceptance suite (C-16).

Both consumer surfaces named in the product spec's `## Consumer Surface(s)` (Agent
`manage_strategy`/`run_backtest`; UI `/insights` strategy editor + results) earn their own steps
(13–16). No new UI page/route is added — the editor already lives at
`services/xstockstrat-ui/src/app/insights/strategies/…` (recon.md:45) — so **C-10(a) nav
registration is NOT required** (decision, not omission).

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` FMP gateway never exceeds rate limit under concurrency | Step 5 |
| `@AC-2` sector change writes new version + closes prior | Step 7 |
| `@AC-3` unchanged sector performs no write | Step 7 |
| `@AC-4` FMP outage does not break classification reads | Step 5 (budget refund on 503) + Step 9 (RPC read serves from store) |
| `@AC-5` as-of lookup returns sector valid at historical timestamp | Step 7 |
| `@AC-6` backtest applies per-sector override as-of each bar | Step 12 |
| `@AC-7` mid-series reclassification does not leak later sector backward | Step 12 |
| `@AC-8` unclassified symbol falls back to default bucket | Step 12 |
| `@AC-9` Sector enum carries an unspecified sentinel | Step 7 |
| `@AC-10` pre-go-live bar for seeded symbol resolves to epoch sector | Step 12 |
| `@AC-11` first post-go-live reclassification closes epoch-seeded row | Step 7 |
| `@AC-12` concurrent first-observation yields exactly one open epoch row | Step 7 |
| `@AC-13` seeded symbol uses epoch sector while unseeded falls back | Step 12 |
| `@AC-14` overrides reach a fundamentals-input formula's params (backtest + live) | Steps 11–12 (re-spec 2026-10-06) |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto) — stubs regenerate the new `Sector`, classification
  messages/RPCs, and field 15.
- Steps 3–9 (marketdata) require Step 2 — Go code references the generated stubs.
- Step 6 (repo + refresh job) requires Step 3 (migration table) and Step 4 (FMP gateway — the
  refresh job reads FMP through the throttled gateway).
- Step 8 (RPC wiring) requires Step 6 (repo).
- Step 11 (analysis resolution) requires Step 2 (field 15 + `GetSectorHistory` stub) and depends on
  Step 8's `GetSectorHistory` RPC being wired (Group A before Group B, per product-spec Open
  Question 1).
- Step 13 (agent) and Step 15 (UI) require Step 1–2 (the `Sector` enum + field 15 must exist so the
  agent Struct mapping and UI exhaustive `Record<Sector,…>` maps compile) and Step 11 (the
  backtest warning they surface). Per `fails.md:81-82,1151` the `Sector` enum's UI exhaustive-map
  fan-out and the agent parity update MUST land in the same PR as the enum — Steps 1, 13, 15 are
  one integration unit.
- Step 17–18 (business-rule promotion) run last (C-16 promotion in the impl PR).

---

### Step 1 — proto: Sector enum, marketdata classification RPCs/messages, StrategyDefinition field 15

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify (add `Sector` enum)
- `packages/proto/marketdata/v1/marketdata.proto` — modify (classification messages + RPCs)
- `packages/proto/analysis/v1/analysis.proto` — modify (`SectorParamOverride`/`SectorValue` messages + `StrategyDefinition` field 15)

**Reviewers**: Proto Reviewer — field number uniqueness / `buf breaking` passes against dev trunk / enum-over-string; xstockstrat-marketdata owner — classification RPC shape; xstockstrat-analysis owner — strategy field 15; packages/proto owner — field number uniqueness + naming conventions

**TDD**: `N/A (proto)`

**Covers**: `—`

**Codebase Evidence**:
- Confirmed via Read `packages/proto/common/v1/common.proto` — the shared-types file already hosts cross-service enums with the `_UNSPECIFIED = 0` sentinel: `TradingMode` (L49-53), `Environment` (L60-65), `BrokerType` (L68-75), `Timeframe` (L85-92). `Asset` (L35-39) carries **no** sector field. No `Sector` enum exists anywhere (recon.md:53,99). `common.v1` is the only package other domains cross-import (packages/proto/CLAUDE.md constitution).
- `marketdata.proto` already imports `common/v1/common.proto` (L8) and `google/protobuf/timestamp.proto` (L7). Service block ends at L63; `Bar.time` is a `google.protobuf.Timestamp` (L67 — the real field name, per `fails.md:726`).
- `analysis.proto`: `StrategyComponent` fields max out at `fundamental_metric = 7` (L321); `StrategyDefinition` fields run to `signal_eligible = 14` (L367) → **next field = 15** (confirmed via Read). `BacktestResult.warnings = 16` already exists (L138) — reused in Step 11, **no new BacktestResult field**. `analysis.proto` already cross-imports `xstockstrat.common.v1.*` (e.g. `PageResponse` L294).

**Instructions**:
1. In `common/v1/common.proto`, add a closed enum `Sector` with `SECTOR_UNSPECIFIED = 0` and the ~11 GICS sectors. **Name the values so the enum-name text matches the sector strings in `acceptance.feature`** (single source of acceptance truth, C-15): the scenarios use `TECHNOLOGY`, `COMMUNICATION_SERVICES`, `ENERGY`, `HEALTH_CARE`. Use: `SECTOR_UNSPECIFIED=0`, `SECTOR_ENERGY`, `SECTOR_MATERIALS`, `SECTOR_INDUSTRIALS`, `SECTOR_CONSUMER_DISCRETIONARY`, `SECTOR_CONSUMER_STAPLES`, `SECTOR_HEALTH_CARE`, `SECTOR_FINANCIALS`, `SECTOR_TECHNOLOGY`, `SECTOR_COMMUNICATION_SERVICES`, `SECTOR_UTILITIES`, `SECTOR_REAL_ESTATE`. **Design fork — do not silently pick (C-11 / behavior #1):** GICS canonical is "Information Technology"; the acceptance scenarios use `TECHNOLOGY`. This spec chooses `SECTOR_TECHNOLOGY` so the stored enum-name text equals the acceptance string `TECHNOLOGY`; surface this to the reviewer rather than assuming. Add a one-line comment: enum values are the SCD `sector` text (design.md:14 "GICS enum name text").
2. In `marketdata.proto`, add three RPCs to `MarketDataService` (after L62, before the closing brace at L63):
   - `rpc GetCurrentSector(GetCurrentSectorRequest) returns (GetCurrentSectorResponse);` — the open (`valid_to IS NULL`) row.
   - `rpc GetSectorAsOf(GetSectorAsOfRequest) returns (GetSectorAsOfResponse);` — point-in-time (FR-5).
   - `rpc GetSectorHistory(GetSectorHistoryRequest) returns (GetSectorHistoryResponse);` — the batched primitive analysis snapshots once per symbol per backtest (design.md:61-63,75-76).
   Add the matching messages. `GetSectorAsOfRequest` carries `string symbol = 1;` + `google.protobuf.Timestamp as_of = 2;`. Each response carries `xstockstrat.common.v1.Sector sector`, plus `GetSectorHistoryResponse` returns `repeated` history rows exposing `sector`, `valid_from`, `valid_to` (a presence-aware form so NULL `valid_to` is distinguishable — use `google.protobuf.Timestamp valid_to` where an unset value = open row), and `string source` (design.md:111-114 — `source='seed'` drives the seed-span marker). **Do not** reuse `1970-01-01` anywhere as a sentinel: an unset `as_of` Timestamp wire-decodes to unix-0, so the epoch seed is `1900-01-01T00:00:00Z` (design.md:34-38), handled in code (Step 6), never as a proto default.
3. In `analysis.proto`, add two messages and `StrategyDefinition` field 15:
   ```
   message SectorValue { xstockstrat.common.v1.Sector sector = 1; double value = 2; }
   message SectorParamOverride {
     string component_ref = 1;   // StrategyComponent.ref_name
     string param_name = 2;      // key within StrategyComponent.params
     double default_value = 3;   // mandatory default bucket (FR-6)
     repeated SectorValue by_sector = 4;
   }
   ```
   Add `repeated SectorParamOverride sector_param_overrides = 15;` to `StrategyDefinition` (after `signal_eligible = 14`, L367). Additive; rides `definition_json` JSONB — no analysis migration (design.md:67-70; recon.md:62,87).
4. Follow proto governance: prefer enum over string for the closed sector set (C-04); every enum has `_UNSPECIFIED = 0`.

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/sector-classification-strategy-params"
```
Both pass (all changes additive — new enum, new RPCs/messages, new field 15; C-09). If the branch ref does not yet exist, use `--against ".git#branch=main-dev"`.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (generated; never hand-edited)
- `packages/proto/gen/python/**` — modify
- `packages/proto/gen/ts/**` — modify (+ compiled `gen/ts/dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness / `buf breaking` passes against dev trunk / enum-over-string; xstockstrat-marketdata owner — classification RPC shape; xstockstrat-analysis owner — strategy field 15; packages/proto owner — field number uniqueness + naming conventions (inherited from Step 1)

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Codebase Evidence**:
- `./scripts/buf-gen.sh` is the canonical generator (root CLAUDE.md § Generating Proto Stubs; `docs/runbooks/proto-versioning.md:82-88`). The `proto-freshness` CI job enforces an empty `git diff packages/proto/gen/` after generation.
- Docker-less host fallback: `docs/runbooks/codegen-toolchain-host-setup.md` (referenced by proto-versioning.md:90-93).

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root — regenerates Go, Python, TS stubs and compiles the TS package.
2. Commit the proto source (Step 1) and the generated stubs in the same commit (proto-versioning.md:36).
3. Never Read/Grep or hand-edit files under `gen/` (root CLAUDE.md Key File Paths).

**Verification**:
```
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Exit 0 (no diff after regeneration) — matches the `proto-freshness` gate.

---

### Step 3 — migration: marketdata 007 symbol_classification (SCD-2)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/migrations/007_symbol_classification.up.sql` — create
- `services/xstockstrat-marketdata/migrations/007_symbol_classification.down.sql` — create

**Reviewers**: DBA — migration NNN numbering / up+down pair / index correctness / partitioning strategy; xstockstrat-marketdata owner — OHLCV/TimescaleDB integrity

**TDD**: `N/A (migration)`

**Covers**: `—`

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-marketdata/migrations/` — last file is `006_dividend_actions.up.sql`/`.down.sql` → **next NNN = 007** (recon.md:26; design.md:161). Convention `NNN_description.up.sql` + `.down.sql` (root CLAUDE.md § Database; C-07). Never edit an applied migration (F-01).
- Schema is `marketdata` (services/xstockstrat-marketdata/CLAUDE.md § Database). Precedent for a **plain** (non-hypertable) audit/table in this schema: `marketdata.ohlcv_remediation_003` (migration `003`, same CLAUDE.md).

**Instructions**:
1. Create `007_symbol_classification.up.sql` — a **plain table** (NOT a hypertable; design.md:14-19,120 — ~1–2 rows/symbol has no chunk-lock surface, neutralizing the feature-153 SQLSTATE 53200 regression by construction):
   ```sql
   CREATE TABLE IF NOT EXISTS marketdata.symbol_classification (
     id           BIGGENERATED ... ,      -- surrogate PK (bigserial/identity)
     symbol       TEXT NOT NULL,
     sector       TEXT NOT NULL,           -- Sector enum-name text (e.g. 'TECHNOLOGY')
     taxonomy     TEXT NOT NULL,           -- e.g. 'GICS'
     source       TEXT NOT NULL,           -- 'fmp' | 'seed'
     valid_from   TIMESTAMPTZ NOT NULL,    -- '1900-01-01T00:00:00Z' for epoch seed rows
     valid_to     TIMESTAMPTZ,             -- NULL = current/open row
     refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
   );
   -- Exactly one open row per symbol (FR-2, AC-12): enforced by a partial-unique index.
   CREATE UNIQUE INDEX IF NOT EXISTS uq_symbol_classification_open
     ON marketdata.symbol_classification (symbol) WHERE valid_to IS NULL;
   -- As-of reads (FR-5, AC-5): symbol + validity interval.
   CREATE INDEX IF NOT EXISTS idx_symbol_classification_asof
     ON marketdata.symbol_classification (symbol, valid_from, valid_to);
   ```
   (Use the repo's established identity/bigserial idiom — inspect a prior `marketdata` migration for the exact column type used elsewhere; do not invent one.)
2. Create `007_symbol_classification.down.sql` — reverse in inverse order: `DROP INDEX` both indexes, then `DROP TABLE marketdata.symbol_classification;`.

**Verification** (offline, no DB — mirrors the `/sdd-execute` HARD CONSTRAINT):
```
ls services/xstockstrat-marketdata/migrations/007_symbol_classification.up.sql \
   services/xstockstrat-marketdata/migrations/007_symbol_classification.down.sql
```
Then read both and confirm by inspection that every `CREATE TABLE`/`CREATE … INDEX` in `.up.sql`
has a matching `DROP` in `.down.sql`. Do **not** spin up a database.

---

### Step 4 — service: centralized rate-limited FMP gateway (one throttle authority at getJSON)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go` — modify (limiter + shared UTC-day budget at `getJSON`)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (retire the two per-path day-counters onto the shared budget; map `ErrFMPDailyCapExceeded` at fetch sites; `maybeAlertQuota` reads a fresh snapshot)
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (feed `marketdata.fmp.rate_limit_rps`; boot-seed the budget once; single shared `fmp.Client`)

**Reviewers**: xstockstrat-marketdata owner — Alpaca/FMP feed integrity, quota-guard correctness; Security — FMP credential still `GetSecret`-resolved, no `FMP_API_KEY` env var reintroduced

**TDD**: `red-green required`

**Covers**: `—`

**Codebase Evidence**:
- FMP client chokepoint confirmed via Read `internal/fmp/fmp_client.go:118` — `getJSON` is the single request site: it builds the URL, calls `c.http.Do(req)` at L128, and treats non-200 as an error at L137-140. All three endpoints (`fetchQuotes` L151, `fetchRatios` L161, `fetchProfile` L174) route through `getJSON`. **No rate limiter today** (recon.md:20; fmp_client.go has no `rate` import).
- Canonical limiter to reuse: `internal/alpaca/client.go:70-72` (`rate.NewLimiter`) + `:86-88` (`limiter.Wait` inside the shared `do()` chokepoint) — recon.md:21,57. Alpaca uses `golang.org/x/time/rate`.
- The two per-path day-counters to consolidate (design.md:54-57): `fundamentalsQuota` reads `marketdata.fmp.daily_request_cap` (=250) and counts DB rows via `CountFundamentalsFetchedToday` — confirmed via grep `internal/service/marketdata_service.go:1550-1562`; `enrichmentUnderCap` uses a dedicated in-memory UTC-day counter — `marketdata_service.go:1881-1885`. Fetch sites that must map `ErrFMPDailyCapExceeded` distinctly (serve-stale/`ResourceExhausted`, not `Unavailable`): `marketdata_service.go:1342,1364,1389,1407` (grep-confirmed). `CountFundamentalsFetchedToday` for the boot-seed: `internal/repository/marketdata_repo.go:565`.
- FMP credential is an encrypted config secret resolved at startup via `GetSecret`/`ResolveSecret` (`cmd/server/main.go:125` `newFundamentalsSource(..., cfg.FMPAPIKey, ...)`; `:80` `resolveSecret("fmp.api_key")` per recon.md:19) — key `marketdata.fmp.api_key`, never an env var (services/xstockstrat-marketdata/CLAUDE.md § Environment Variables; `fails.md:1566-1568`; F-07). Do not touch this resolution.
- Single shared `fmp.Client` risk (design.md:135-138): the refresh job (Step 6) and the fundamentals serving path MUST consume the **same** `*fmp.Client` instance or the budget splits into 2×cap (`fails.md:1038` parallel-path trap). `main.go:125` is where the one client is constructed.

**Instructions**:
1. In `fmp_client.go`, add a `golang.org/x/time/rate` limiter to `Client` (mirror `alpaca/client.go:70-72`): `rate.NewLimiter(rps, 1)` — **burst = 1** for a strict rolling-1s window (AC-1; design.md:44-46). Add `rps` to `ClientConfig` fed from the new `marketdata.fmp.rate_limit_rps` key (Step 10). Call `limiter.Wait(ctx)` at the top of `getJSON` (before building the request at L124), so every FMP call is throttled at the one chokepoint.
2. Add a single shared `fmpDayBudget{ mu, utcDay, used, cap }` on `Client` with **reserve/commit/refund** (design.md:47-59): roll the UTC day; `reserve()` **before** `c.http.Do` (L128) → return a new sentinel `ErrFMPDailyCapExceeded` when `used >= cap`, else `used++`; a `defer` **refunds** the slot unless the request reached the HTTP-200 path (so a 503 storm refunds every slot — the AC-4 self-throttle fix). Read `cap` live from `marketdata.fmp.daily_request_cap` (design.md:51; C-18 — one throttle, not two).
3. In `main.go`, **boot-seed** the budget once from `CountFundamentalsFetchedToday` (`marketdata_repo.go:565`) so a mid-day restart cannot re-grant a fresh 250 (design.md:55-57; a conservative floor — accepted, see design Open Risks). Ensure the **one** `fmp.Client` built at `main.go:125` is the same instance the Step-6 refresh job uses (design Open Risk #1).
4. In `marketdata_service.go`, retire the two independent counters (`fundamentalsQuota` DB-count at `:1562` and `enrichmentUnderCap` in-memory at `:1885`) onto the shared budget so every FMP path shares one gate (design.md:54-57). At the fetch sites (`:1342,:1389`) map `ErrFMPDailyCapExceeded` to the existing serve-stale/`ResourceExhausted` behavior (distinct from `CodeUnavailable`). Fix `maybeAlertQuota` to read `BudgetSnapshot()` **fresh post-fetch** rather than `count + len(fetched)` (design.md:139-140 / Open Risk #2), or the 80% WARNING double-counts.
5. Do not reintroduce `FMP_API_KEY` as an env var (F-07; `fails.md:1566`). Reuse the existing `GetSecret` resolution untouched.

**Verification**: see paired Step 5.

---

### Step 5 — test: FMP gateway rate limit + budget refund

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/fmp/fmp_client_test.go` — create or modify
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (budget-refund + `maybeAlertQuota` snapshot)

**Reviewers**: xstockstrat-marketdata owner — quota-guard correctness

**TDD**: `red-green required`

**Covers**: `AC-1, AC-4`

**Codebase Evidence**:
- FMP client is test-injectable: `ClientConfig.HTTPClient` is injectable "so tests can assert call counts and stub responses" (fmp_client.go:25-27, confirmed via Read). Use a stub `http.Client`/`RoundTripper` counting outbound calls.
- Service-level fake exists: `fakeFundRepo.CountFundamentalsFetchedToday` (`marketdata_service_test.go:204`); config fakes with `ints` map already stub `marketdata.fmp.daily_request_cap` (`:300,:1668,:1696`). Reuse these (C-13 — a second consumer of the cap literal already lives in this file; no new fixture home).
- C-13 (non-frontend test data): the domain literals (cap=250, rps) are single-consumer within these test files → inline is compliant; record that verdict.

**Instructions** (author RED first — assert new behavior against the pre-Step-4 tree, P-06):
1. **AC-1**: with `rps=5` and burst=1, fire 50 concurrent `getJSON`-driven calls (via a stubbed HTTP client) and assert no more than 5 outbound requests occur in any rolling 1-second window (measure dispatch timestamps). This RED-fails today (no limiter).
2. **AC-4 (budget refund on outage)**: stub the HTTP client to return HTTP 503 for every request; assert the shared budget's `used` returns to its pre-cycle value (every slot refunded) after the failing cycle, i.e. a 503 storm does not self-throttle later real fetches.
3. Assert one shared budget: a call on the fundamentals path and a call on the (Step-6) refresh path both increment the same counter (design Open Risk #1). Assert `maybeAlertQuota` reads a fresh snapshot (Open Risk #2).

**Verification** (coverage + lint, C-08/§B):
```
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40%. New limiter/budget logic lands in `internal/fmp/` (a coverage-measured package) — the `fmp_client_test.go` cases carry the threshold; the `marketdata_service.go`/`cmd` edits are in CI-excluded packages, so integration-level assertions in `marketdata_service_test.go` are sufficient there.

---

### Step 6 — service: ClassificationRepo (SCD reads) + refresh/seed job

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/classification_repo.go` — create (`ClassificationRepo`: `GetCurrentSector`, `GetSectorAsOf`, `GetSectorHistory`, the three-way upsert/version writer, epoch-seed `INSERT … ON CONFLICT DO NOTHING`)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (classification refresh ticker-poller; fundamentals-profile write-through seed)
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (start the refresh goroutine, gated by `marketdata.classification.enabled` + `.refresh_interval_hours`)

**Reviewers**: xstockstrat-marketdata owner — SCD-2 versioning correctness, one-open-row invariant, poller cadence

**TDD**: `red-green required`

**Covers**: `—` (covered by Step 7)

**Codebase Evidence**:
- Repo pattern to mirror: `internal/repository/marketdata_repo.go:29-35` (`MarketDataRepo` + `execer`), pgxmock tests `marketdata_repo_test.go:11,19-60` (recon.md:25,61). Reuse the existing pool (no new DB connection — F-06; design.md:20,177). Pool guard: `internal/repository/pool.go:18-34` (`DB_POOL_MAX` default 2).
- Ticker-poller template: `StartWarmQuotePoller` (`marketdata_service.go:801`) and `StartBarIngestPoller` (`:876`) — ticker loops that re-read the interval per tick and pause on `interval<=0` (recon.md:24,59). Wired as goroutines in `cmd/server/main.go:145` / `:147` (grep-confirmed). Background pollers run on the long-lived `main` ctx and carry **no** propagation headers (services/xstockstrat-marketdata/docs/context-constitution.md:39) — intentional; the refresh job follows the same rule.
- FMP profile as the sector source: `fetchProfile` (`fmp_client.go:170-181`) already fetches `/stable/profile`; `fmpProfile` (`:239-249`) currently extracts only `Beta`/`Currency` — extend it to also read FMP's `sector` string. Route through the throttled gateway from Step 4 (recon.md:57).
- FMP→Sector mapping: FMP profile returns free-text sector (e.g. "Information Technology", "Communication Services"); map to the `Sector` enum-name text stored in the SCD row (design.md:14). An unmappable/empty FMP sector must not create a bogus row (fail safe — no write).
- Epoch sentinel: `1900-01-01T00:00:00Z` constant in Go, **not** 1970 (design.md:34-38). Uniform no-open-row branch across both writers (refresh job + fundamentals profile write-through) via `INSERT (valid_from = EPOCH_SENTINEL) … ON CONFLICT ((symbol) WHERE valid_to IS NULL) DO NOTHING` (design.md:27,38-42; AC-12).

**Instructions**:
1. Create `ClassificationRepo` mirroring `MarketDataRepo`/`execer` (`marketdata_repo.go:29-35`), reusing the existing pool:
   - `GetCurrentSector(ctx, symbol)` → the open (`valid_to IS NULL`) row.
   - `GetSectorAsOf(ctx, symbol, ts)` → the row where `valid_from <= ts AND (valid_to IS NULL OR valid_to > ts)` (FR-5; AC-5). Boundary convention: `valid_from` inclusive, `valid_to` exclusive.
   - `GetSectorHistory(ctx, symbol, range)` → all rows intersecting the range, exposing `sector`, `valid_from`, `valid_to`, `source` (design.md:111-114 — `source` drives the seed-span marker).
   - Epoch-seed writer: `INSERT (symbol, sector, taxonomy='GICS', source='seed', valid_from=EPOCH_SENTINEL, valid_to=NULL) … ON CONFLICT (partial-unique open index) DO NOTHING` (AC-12 — concurrent first-observation yields exactly one open epoch row).
   - Change-transition writer (one per-symbol txn, READ COMMITTED): `SELECT … FOR UPDATE` the open row, re-check the sector inside the txn, then `UPDATE valid_to = now()` on the prior row + `INSERT` a new open row `valid_from = now(), source='fmp'` (AC-2, AC-11). `valid_from = now()` is used **only** for the post-go-live change transition, never first observation (design.md:42).
2. Add `StartClassificationRefreshPoller` following the `StartWarmQuotePoller`/`StartBarIngestPoller` ticker template (`marketdata_service.go:801,876`): each cycle, for every warm symbol, fetch FMP profile via the **Step-4 throttled gateway** and run the three-way branch — no open row → epoch-seed INSERT (DO NOTHING); open row + sector unchanged → **no write** (AC-3); open row + sector changed → the change-transition txn (AC-2). Gate the loop on `marketdata.classification.enabled` and re-read `marketdata.classification.refresh_interval_hours` per tick (`interval<=0` pauses — the poller-template convention).
3. Add the **fundamentals-profile write-through seed**: on the existing fundamentals fetch path where `fetchProfile` already runs (recon.md:19,63 — `GetFundamentalsMulti` extended branch), when the profile carries a sector and the symbol has no open row, perform the same epoch-seed `ON CONFLICT DO NOTHING` INSERT (design.md:38-42 — both writers share the uniform no-open-row branch).
4. Wire the refresh goroutine in `main.go` next to the existing `go svc.StartWarmQuotePoller(ctx)` / `go svc.StartBarIngestPoller(ctx)` (`:145`,`:147`). Reads never call FMP (FR-4; design.md:61-63).

**Verification**: see paired Step 7.

---

### Step 7 — test: classification repo + refresh job (SCD versioning, seed, as-of, enum sentinel)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/repository/classification_repo_test.go` — create (pgxmock)
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify (refresh-job three-way branch)

**Reviewers**: xstockstrat-marketdata owner — SCD-2 versioning correctness

**TDD**: `red-green required`

**Covers**: `AC-2, AC-3, AC-5, AC-9, AC-11, AC-12`

**Codebase Evidence**:
- pgxmock repo-test pattern: `marketdata_repo_test.go:11,19-60` (recon.md:25,61) — reuse for `classification_repo_test.go`.
- Service-level fakes/config stubs: `marketdata_service_test.go` (`fakeFundRepo` `:204`, config `ints` maps `:300`).
- `Sector` enum is generated in Go by Step 2 (`common/v1`); Go exposes `commonv1.Sector_name[0] == "SECTOR_UNSPECIFIED"` for the AC-9 sentinel assertion.
- C-13: SCD row literals are single-consumer within these test files → inline compliant; record that verdict.

**Instructions** (author RED first, P-06):
1. **AC-2**: given one open row `(XYZ, TECHNOLOGY, valid_to NULL)`, when the refresh job observes FMP reports `COMMUNICATION_SERVICES`, assert the prior row's `valid_to` is set to the refresh timestamp, a new open row `(COMMUNICATION_SERVICES, valid_to NULL)` is inserted, and exactly one open row exists.
2. **AC-3**: given one open row `(XYZ, TECHNOLOGY)`, when FMP still reports `TECHNOLOGY`, assert no insert/update occurs and `valid_from` is unchanged.
3. **AC-5**: seed rows `XYZ = TECHNOLOGY [2018-01-01, 2018-10-01)` and `COMMUNICATION_SERVICES [2018-10-01, NULL)`; assert `GetSectorAsOf(XYZ, 2018-06-15)` returns `TECHNOLOGY`. Also assert boundary correctness (`valid_from` inclusive, `valid_to` exclusive).
4. **AC-11**: given an epoch-seeded open row `(XYZ, TECHNOLOGY, valid_from 1900-01-01)`, when FMP reports `ENERGY` at `2026-10-01`, assert the seeded row's `valid_to = 2026-10-01`, a new open row `(ENERGY, valid_from 2026-10-01)` is inserted, `GetSectorAsOf(XYZ, 2015-06-15)` still returns `TECHNOLOGY`, and `GetSectorAsOf(XYZ, 2026-10-02)` returns `ENERGY`.
5. **AC-12**: simulate two concurrent first-observations of `NEWCO` (`HEALTH_CARE`); assert the `ON CONFLICT DO NOTHING` epoch-seed yields exactly one open row with `valid_from = 1900-01-01` and `valid_to = NULL`. (pgxmock: assert the second insert affects zero rows.)
6. **AC-9**: assert the generated Go `Sector` enum zero value name is `SECTOR_UNSPECIFIED` (`commonv1.Sector_name[0]`).

**Verification** (coverage + lint, C-08/§B):
```
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
The repo (`repository/`) and service (`service/`) packages are CI-**excluded** from coverage measurement — note this: "New logic is in excluded packages (`repository/`, `service/`); no coverage threshold applies to it — the pgxmock repo tests + service refresh-job tests are the verification." A `test` step is still required (this one). Confirm the suite passes and `total:` ≥ 40% (satisfied by the wider package set).

---

### Step 8 — service: wire GetCurrentSector / GetSectorAsOf / GetSectorHistory RPCs

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify (three new RPC handlers)
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (service methods delegating to `ClassificationRepo`)

**Reviewers**: xstockstrat-marketdata owner — RPC contract + read-never-hits-FMP invariant

**TDD**: `red-green required`

**Covers**: `—` (covered by Step 9)

**Codebase Evidence**:
- Handler pattern: `internal/handler/marketdata_handler.go:180,316` (existing RPC handlers, e.g. `ListAssets`) — recon.md:24. Service-method delegation: `internal/service/marketdata_service.go` (e.g. `ListAssets` `:1010-1019`).
- The generated `MarketDataServiceServer` interface gains the three RPC methods from Step 2 — the handler must implement them or the build fails.

**Instructions**:
1. Add `GetCurrentSector`, `GetSectorAsOf`, `GetSectorHistory` handlers in `marketdata_handler.go` mirroring the existing handler shape (`:180,316`), each delegating to the corresponding `ClassificationRepo` read (Step 6). Map an unknown/absent classification to a `SECTOR_UNSPECIFIED` response (never an error — FR-4).
2. Reads serve **only** from the local table; never call FMP on the read path (FR-4; design.md:61-63). No propagation-header change needed — these are inbound-only reads (no new outbound per-request gRPC call), so §B header-propagation does not apply here.

**Verification**: see paired Step 9.

---

### Step 9 — test: classification RPC reads (outage-tolerant, as-of at the RPC boundary)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler_test.go` — create or modify

**Reviewers**: xstockstrat-marketdata owner — RPC contract

**TDD**: `red-green required`

**Covers**: `AC-4`

**Codebase Evidence**:
- Handler test precedent lives alongside `marketdata_handler.go` (recon.md:24 handler locations). Reuse the service/repo fakes established in Steps 5/7.

**Instructions** (author RED first, P-06):
1. **AC-4**: with the FMP stub returning HTTP 503 for every request during a refresh cycle, and an existing open row `(XYZ, ENERGY)`, assert `GetCurrentSector(XYZ)` returns `ENERGY` from the local store and does **not** error. Assert no FMP call is made on the read path.

**Verification** (coverage + lint, C-08/§B):
```
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-marketdata && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
`handler/` is a CI-excluded package — note: "New logic is in an excluded package (`handler/`); no coverage threshold applies; the handler test is the verification." Confirm the suite passes and `total:` ≥ 40%.

---

### Step 10 — config: register the new marketdata config keys

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (add the three keys to § Config Keys Consumed)
- `docs/patterns/config-governance.md` — modify (add the three keys to the Per-Feature Registered Keys log)

**Reviewers**: xstockstrat-marketdata owner — config key naming (`<service>.<category>.<key>`), defaults declared in service CLAUDE.md

**TDD**: `N/A (config)`

**Covers**: `—`

**Codebase Evidence**:
- Existing `marketdata.fmp.*` keys and the `<service>.<category>.<key>` convention are documented in services/xstockstrat-marketdata/CLAUDE.md § Config Keys Consumed (confirmed via Read: `marketdata.fmp.daily_request_cap` = 250, `marketdata.fmp.base_url`, `marketdata.fmp.enabled`, …). Defaults declared per-service in CLAUDE.md is the C-05 rule.
- Naming precedent `marketdata.<source>.rate_limit_rps` already exists: `marketdata.backfill.rate_limit_rps` (=200) and `marketdata.edgar.rate_limit_rps` (=10) — services/xstockstrat-marketdata/CLAUDE.md (recon.md, product-spec Design Guidance). The new FMP key fits it.
- Config keys are read via the `WatchConfig` stream typed getters (`internal/config/config.go:138-180`, recon.md:22,60); no hardcoded values (F-07).

**Instructions**:
1. Add to services/xstockstrat-marketdata/CLAUDE.md § Config Keys Consumed:
   - `marketdata.fmp.rate_limit_rps` (int, default: choose a paid-starter-tier-safe value and state it; reconcile with `marketdata.fmp.daily_request_cap` = 250 so the gateway has **one** coherent throttle — C-18; design.md:44-59) — FMP token-bucket ceiling (burst=1).
   - `marketdata.classification.enabled` (bool, default `false`) — feature gate for the classification refresh job.
   - `marketdata.classification.refresh_interval_hours` (int, default: state it) — refresh cadence; `<=0` pauses the poller (interval-not-cron, per context.md round-1 amendment).
2. Add the same three keys to the Per-Feature Registered Keys log in `docs/patterns/config-governance.md` under this feature.
3. These are **new non-breaking keys** → per config-rollout.md governance, service-owner approval + this CLAUDE.md documentation PR (no `SetConfig` value change required at spec time).

**Verification**:
```
grep -n "marketdata.fmp.rate_limit_rps\|marketdata.classification.enabled\|marketdata.classification.refresh_interval_hours" services/xstockstrat-marketdata/CLAUDE.md docs/patterns/config-governance.md
```
All three keys present in both files, following `<service>.<category>.<key>`. (This documents the keys the code in Step 4/6 reads via the Watcher — no hardcoded value, F-07.)

---

### Step 11 — service: analysis per-sector param resolution + ManageStrategy validation + seed-span warning

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`_backtest_symbol_definition`: one `GetSectorHistory` per symbol; `sector_by_bar` resolution as-of `bar.time`; `ManageStrategy` validation + fingerprint fold; seed-span `warnings` append)
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify (`_assemble_component_series`/`_compute_component`: compute-K-distinct-param-variants + per-bar stitch; default-bucket fallback)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**TDD**: `red-green required`

**Covers**: `—` (covered by Step 12)

**Codebase Evidence**:
- `RunBacktest` `servicer.py:635`; `_backtest_symbol_definition` `:1700`; per-bar decision loop `:1791`; series computed **once over the whole window** then `evaluate_with_series` `:1730-1732` (recon.md:29-31).
- Compute seam confirmed via Read: `evaluator.py:398` `_compute_component(comp, closes)` builds `dict(comp.params)` (L414 builtin `params=dict(comp.params)`; L423-424 formula `input_params` from `dict(comp.params)`). `_assemble_component_series` at `:587` is "the single computation unit behind every StrategyComponent consumer" (docstring L600-602) and already takes pre-fetched `closes` + `eval_dates` — so K full-window computes ride pre-fetched closes with **no** extra `GetBars` (design.md:87-89; no chunk-lock re-exposure, preserving feature-153 `@AC-1/@AC-2`).
- marketdata client stub + header propagation: `servicer.py:400` (stub), `_fetch_bars_paged` `:1124-1178`, header trio `:656-660`, `metadata=propagation_meta` at `:1155` (recon.md:32,64). The new `GetSectorHistory` call mirrors this — a **new outbound gRPC call to marketdata** that MUST forward `x-user-id`/`x-access-scope`/`x-trace-id` (§B header propagation; C-03) by reusing `propagation_meta` exactly as `_fetch_bars_paged` does.
- `bar.time` is the real proto field (marketdata.proto:67 `google.protobuf.Timestamp time`), NOT `bar.timestamp` — use real `Bar` fixtures, not `MagicMock` (`fails.md:726-728`; design.md:76-78).
- ManageStrategy JSONB serialize `servicer.py:2591,2631-2640`; strategy persistence rides `analysis.strategies.definition_json` JSONB (`app/repositories/strategies.py:6-8,41-54`, confirmed via Read — whole `StrategyDefinition` stored as one JSONB column, no migration). `source_symbol` precedent for a definition field that normalizes server-side and folds into the fingerprint: services/xstockstrat-analysis/CLAUDE.md § Benchmark operand "Write path" + recon.md:80 (`@AC-6 @feature-152`).
- Default bucket must be a fixed default, **never** a forward-fill of a prior sector across an SCD boundary (feature-152 `@AC-3`; recon.md:78,96; design.md:79-80).
- No-override byte-parity: K=1 when no overrides declared → byte-identical to today (design.md:91-92; preserves feature-151/149/152; recon.md:75-79,97).

**Instructions**:
1. In `_backtest_symbol_definition` (`servicer.py:1700`), issue **one** `GetSectorHistory(symbol, range)` per symbol per backtest, mirroring `_fetch_bars_paged`'s `metadata=propagation_meta` (`:1155`) so the header trio propagates (C-03). Snapshot the returned intervals at run start; build `sector_by_bar[i]` by resolving the covering row as-of each `bar.time` locally (no per-bar RPC; design.md:75-78). A bar with **no covering row** → the fixed `default_value` bucket (never a carry-forward; feature-152 `@AC-3`).
2. In `evaluator.py`, thread the resolved per-sector params through `_assemble_component_series` → `_compute_component` (`:398`). For a component carrying overrides (from `StrategyDefinition.sector_param_overrides`, field 15): collect the **K distinct resolved param dicts** across the window (K ≤ ~11, usually 1), compute the component series **once per distinct dict over the full-window closes** (each a full contiguous compute so warmup/lookback is correct at any mid-window sector boundary — design.md:82-91), then stitch `out[i] = variant[sector_by_bar[i]][i]`. **No overrides → K=1 → the existing single compute unchanged** (byte-identical; design.md:91-92). The K computes ride the **existing** analysis semaphores (`analysis.series.max_concurrent_components`, `analysis.compute.max_worker_threads`) — **no new config key** (design.md:89-91).
3. In `ManageStrategy` (`servicer.py:2591`), validate each `SectorParamOverride` `(component_ref, param_name)` resolves to a real component/param and reject `INVALID_ARGUMENT` otherwise; normalize server-side and fold field 15 into the definition fingerprint so a changed override clears the derived grade (feature-152 `@AC-6` precedent; design.md:71-73). Rides the existing update-mask discipline (recon.md:82 `@feature-149`).
4. **Seed-span warning**: analysis derives the marker locally from `GetSectorHistory` rows exposing `source='seed'` + `valid_from` — a backtest whose window precedes the symbol's earliest non-seed classification (or resolves any bar against a seed row) appends an entry to the existing `BacktestResult.warnings` (analysis.proto:138 — **no new proto field**; design.md:98-115). This makes the bounded pre-go-live look-ahead visible (FR-10; C-16 user sign-off, context.md 2026-09-27).

**Verification**: see paired Step 12.

---

### Step 12 — test: analysis per-sector resolution (look-ahead, fallback, seed span, parity)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/` — create/modify test module(s) for backtest sector resolution
- `services/xstockstrat-analysis/tests/conftest.py` — modify if a `Bar`/history fixture gains a second consumer (C-13)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, no look-ahead bias

**TDD**: `red-green required`

**Covers**: `AC-6, AC-7, AC-8, AC-10, AC-13`

**Codebase Evidence**:
- Coverage gate: `--cov-fail-under=40` (spec-template.md table; services/xstockstrat-analysis/CLAUDE.md § Running Tests). Lint: `ruff check . && ruff format --check .`.
- Use **real `Bar` proto fixtures** with the real `time` field, never `MagicMock` (which hides the `bar.time` vs `bar.timestamp` error — `fails.md:726-728`; design.md:76-78). The mid-series look-ahead test must inject a **mid-series reclassification**, not merely endpoints (`fails.md:1852-1868`; product-spec Design Guidance).
- C-13: a `Bar`-list / sector-history fixture used by more than one test in this module moves to `tests/conftest.py` (Python canonical home, which exists); a single-consumer literal stays inline — record the verdict per fixture.

**Instructions** (author RED first, P-06):
1. **AC-6**: strategy sets RSI oversold default 30, override 25 for `TECHNOLOGY`; `XYZ` is `TECHNOLOGY` for every bar; assert every bar is scored with threshold 25.
2. **AC-7** (mid-series, no look-ahead — the critical case): override 25 for `TECHNOLOGY`, 20 for `COMMUNICATION_SERVICES`; `XYZ` is `TECHNOLOGY` through 2018-09-30 then `COMMUNICATION_SERVICES` from 2018-10-01; backtest 2018-08-01→2018-11-30; assert bars ≤ 2018-09-30 use threshold 25 and bars ≥ 2018-10-01 use threshold 20 (assert **interior** bars, not just endpoints).
3. **AC-8**: default 30, override 25 for `TECHNOLOGY`; `NEWCO` has no classification row for any bar; assert every bar uses threshold 30 and the backtest completes without error.
4. **AC-10**: `XYZ` has one epoch-seeded open row `(TECHNOLOGY, valid_from 1900-01-01)`; default 30, override 25 for `TECHNOLOGY`; backtest 2015; assert every bar uses threshold 25 (pre-go-live bar resolves to the epoch-seeded sector, not the default).
5. **AC-13**: in one backtest over `XYZ` (epoch-seeded `TECHNOLOGY`) and `NEWCO` (no row), assert `XYZ` bars use 25 and `NEWCO` bars use 30.
6. **No-override parity** (guard, not an AC): a strategy with no `sector_param_overrides` produces byte-identical output to the pre-feature path (K=1; preserves feature-151/149/152).

**Verification** (coverage + lint, C-08/§B):
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40
```
Confirm the suite passes and coverage ≥ 40%.

---

### Step 13 — service: agent manage_strategy per-sector arg + run_backtest passthrough + parity surfaces

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify (map the per-sector override list into `StrategyDefinition.sector_param_overrides`)
- `services/xstockstrat-agent/app/tools.py` — modify (`manage_strategy` new arg + `supplied` merge-mask entry)
- `services/xstockstrat-agent/app/backtest_view.py` — modify only if the seed-span `warnings` are not already surfaced (see Evidence)
- `docs/runbooks/mcp-tools.md` — modify (`manage_strategy` parameter table)
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify (same-PR repo rule)
- `services/xstockstrat-agent/CLAUDE.md` — modify (tool-count / surface parity if wording changes)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability + `docs/runbooks/mcp-tools.md` parity + six inventory surfaces kept in sync

**TDD**: `red-green required`

**Covers**: `—` (covered by Step 14)

**Codebase Evidence**:
- `manage_strategy` tool `app/tools.py:870`; `supplied` merge-mask dict `:994` (recon.md:40). Client builder `manage_strategy` confirmed via Read `app/client.py:849`; it builds `pb_def = analysis_pb2.StrategyDefinition(...)` at `:879-894` and does a `Struct` `CopyFrom` for `signal_params` at `:895-899` — the precedent mapping pattern for the new field. `denied_symbols`/`signal_eligible` (fields 12/14) are already mapped at `:892-893` — mirror that for `sector_param_overrides` (field 15, `repeated` message, not a Struct).
- `run_backtest` tool `app/tools.py:734`; view builder `app/backtest_view.py:54`, key allowlists `:36,38`; **descriptor-parity guard** `tests/test_backtest_view.py:189` (recon.md:41). Design reuses `BacktestResult.warnings` (analysis.proto:138) — no new `BacktestResult` field → **no agent descriptor-parity break** (design.md:98-101). Confirm whether `warnings` already flows through `backtest_view` (feature 086 added the warnings channel per recon.md); if it does, no `backtest_view.py` change is needed — state that verdict rather than adding a redundant mapping.
- Six inventory surfaces + mcp-tools.md parity: `docs/runbooks/mcp-tools.md:447,280`; six surfaces enumerated `docs/roadmap/ledger/insights.md:2660` (recon.md:43). Tool count stays fifty-two — this adds an **argument**, not a tool (services/xstockstrat-agent/CLAUDE.md § MCP Tools).
- Same-PR repo rule: a `run_backtest`/`manage_strategy` API change must update `plugins/strat-lab/skills/backtest/SKILL.md` in the same PR (recon.md:100; root CLAUDE.md Context Guide strat-lab row).
- `manage_strategy` forwards the caller's own `x-user-id` (ownership-gated, not admin — feature 133); the new arg does not change that (services/xstockstrat-agent/CLAUDE.md § Management-tool authorization).

**Instructions**:
1. In `client.py:879-899`, map a `sector_param_overrides` list from the tool `definition` dict into `pb_def.sector_param_overrides` (`repeated SectorParamOverride`), mirroring how `denied_symbols` (`:892`) and the `signal_params` Struct (`:895-899`) are handled — build each `SectorParamOverride`/`SectorValue` message; the `Sector` enum value comes from `common_pb2.Sector` by name.
2. In `tools.py:870`, add the per-sector override map argument to `manage_strategy` and add its key to the `supplied` merge-mask (`:994`) so `update` masks it like the other definition fields (recon.md:65).
3. `run_backtest`: the seed-span marker rides `BacktestResult.warnings`. If `backtest_view.py` already surfaces `warnings`, no change; else add `warnings` to the view (allowlist `:36,38`) — but **do not** add a new proto field (design.md:98-101). Whichever, keep `tests/test_backtest_view.py:189` descriptor-parity green.
4. Update `docs/runbooks/mcp-tools.md` `manage_strategy` parameter table (and any of the six inventory surfaces whose wording changes) — parity is the agent-owner review focus. Tool count is unchanged (still fifty-two).
5. Update `plugins/strat-lab/skills/backtest/SKILL.md` in this same PR (repo rule) to document the per-sector override authoring on `manage_strategy` and the seed-span `warnings` on `run_backtest`.

**Verification**: see paired Step 14.

---

### Step 14 — test: agent manage_strategy field + descriptor parity

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_backtest_view.py` — modify (parity stays green)
- `services/xstockstrat-agent/tests/` — add a `manage_strategy` per-sector mapping test

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability

**TDD**: `red-green required`

**Covers**: `—`

**Codebase Evidence**:
- Descriptor-parity guard `tests/test_backtest_view.py:189` (recon.md:41) — the test that fails if a `BacktestResult` field is added without a view update; since no field is added, it must stay green.
- Sibling parity tests: `tests/test_opportunity_projection.py`, `tests/test_signal_source_projection.py` (recon.md:42) — pattern for a projection/mapping test.
- Coverage gate 40%; lint `ruff check . && ruff format --check .` (services/xstockstrat-agent/CLAUDE.md § Running Tests).

**Instructions** (author RED first, P-06):
1. Assert `manage_strategy` maps a `sector_param_overrides` definition entry into `StrategyDefinition.sector_param_overrides` with the correct `Sector` enum values, `component_ref`, `param_name`, `default_value`, and `by_sector` — RED against the pre-Step-13 client.
2. Assert `update` masks the new field via the `supplied` merge-mask (a name-only update does not wipe overrides).
3. Confirm `test_backtest_view.py:189` descriptor-parity remains green (no new `BacktestResult` field).

**Verification** (coverage + lint, C-08/§B):
```
cd services/xstockstrat-agent && ruff check . && ruff format --check .
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40
```
Confirm the suite passes and coverage ≥ 40%.

---

### Step 15 — service: UI per-sector override authoring + Sector Record fan-out + sector-resolved backtest display

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/ComponentEditor.tsx` — modify (per-sector override authoring)
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify (thread the override map through the wizard)
- `services/xstockstrat-ui/src/components/insights/BacktestDiagnostics.tsx` — modify (extend exhaustive `Record<…>` maps for the new `Sector` enum; render sector-resolved output + seed-span warning)
- `services/xstockstrat-ui/src/lib/formulaReference.ts` — modify (exhaustive `Record` map at `:177`)
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify only if a new field must pass through `manageStrategy`/`runBacktest` typed client shape

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety, C-17 tokens/primitives, no hardcoded colors

**TDD**: `red-green required`

**Covers**: `—` (covered by Step 16)

**Codebase Evidence**:
- Strategy editor already exists in `/insights` (recon.md:44-45): `src/app/insights/strategies/new/page.tsx:18`, `[id]/edit/page.tsx:35`, `StrategyWizard.tsx:104` (4 steps), `ComponentEditor.tsx:41` (`params: Record<string, number>` — the precedent shape the per-sector overrides extend). **No new page/route → no `PLATFORM_SUBNAV` registration / C-10(a) nav test required** (recon.md:49; product-spec Open Question 3).
- Exhaustive `Record<Enum,…>` maps that break `tsc` when a proto enum gains a value (must be extended in the **same PR** as the `Sector` enum — `fails.md:81-82,1151`; design.md:106-107): `BacktestDiagnostics.tsx:17,25,31,40`; `formulaReference.ts:177` (recon.md:47).
- Backtest render: `src/app/insights/strategies/[id]/page.tsx:562-628`; `BacktestDiagnostics.tsx:71` (recon.md:46). The seed-span marker arrives on `BacktestResult.warnings` and reaches the UI `backtest-warnings` card (design.md:100-101,108-115) — surface it there.
- BFF typed client: `src/lib/insightsBff.ts:30` (`AnalysisService`: `manageStrategy` :46, `runBacktest` :38); route `src/app/insights/api/[...connect]/route.ts` (recon.md:48).
- C-17: consume design-role tokens (no hardcoded hex/oklch; tokens in `src/app/globals.css:8`), reuse existing `ui/*` primitives + variants, give every control a unique accessible name, route loading/empty/error through the canonical primitives (docs/patterns/ui-ux-governance.md).

**Instructions**:
1. Extend `ComponentEditor.tsx` (`:41`, `params: Record<string, number>`) with a per-sector override authoring control: for a declared param, allow a mandatory default plus per-`Sector` override values. Reuse existing `ui/*` primitives + design tokens (C-17); no hardcoded colors.
2. Thread the override map through `StrategyWizard.tsx` (`:104`) into the `manageStrategy` BFF call (`insightsBff.ts:46`).
3. Extend **every** exhaustive `Record<Sector,…>`-shaped map for the new enum — `BacktestDiagnostics.tsx:17,25,31,40` and `formulaReference.ts:177` — so `tsc` compiles (same-PR fan-out, `fails.md:81-82,1151`).
4. Render sector-resolved backtest output and the seed-span warning (from `BacktestResult.warnings`) in `BacktestDiagnostics.tsx` / `strategies/[id]/page.tsx:562-628`, routing the warning through the canonical state primitive (e.g. `CardNotice`), not hand-rolled markup (C-17).

**Verification**: see paired Step 16.

---

### Step 16 — test: UI Playwright + vitest (authoring + sector-resolved display)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/` — add/modify a Playwright spec for per-sector authoring + sector-resolved backtest display
- `services/xstockstrat-ui/e2e/fixtures/strategies.ts` — modify (extend the strategy fixture with `sector_param_overrides`)
- `services/xstockstrat-ui/e2e/fixtures/backtests.ts` — modify (a fixture with a seed-span `warnings` entry)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog rows for any new/changed fixture)
- `services/xstockstrat-ui/src/lib/*.test.ts` — add a vitest unit test if new `src/lib/` logic is introduced (mapping/serialization)

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety

**TDD**: `red-green required`

**Covers**: `—`

**Codebase Evidence**:
- Frontend test-data inventory (C-12): fixtures live in `e2e/fixtures/` with `INVENTORY.md`; `strategies.ts` and `backtests.ts` exist (recon.md:50). Auth helpers `e2e/helpers/auth.ts` (`addAuthCookie`/`addAdminCookie`/`addCookieWithRoles`) — new specs never re-implement JWT signing (discovery-checklist §j).
- Vitest: node-environment `src/**/*.test.ts`, coverage scoped to `src/lib/**` (root CLAUDE.md Language Versions — Vitest row). Playwright is the e2e harness for `xstockstrat-ui`.

**Instructions** (author RED first where a unit test applies, P-06):
1. Playwright: author a per-sector override on a strategy via the editor (reusing `e2e/fixtures/strategies.ts` extended with `sector_param_overrides` — C-12, not an inline literal) and assert it round-trips through the `manageStrategy` BFF call. A new domain shape gets a fixture + `INVENTORY.md` row in this step.
2. Playwright: render a backtest whose result carries a seed-span `warnings` entry (fixture in `backtests.ts`) and assert the warning card and sector-resolved output display.
3. If Step 15 introduced `src/lib/` mapping/serialization logic, add a vitest unit test for it (coverage scoped to `src/lib/**`).
4. Reuse `e2e/helpers/auth.ts` cookies; do not re-implement auth.

**Verification** (§B — C-12 fixture imports + e2e):
```
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/<touched spec files>
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e   # (and pnpm test / vitest if a src/lib unit test was added)
```
Confirm fixture/auth imports resolve, `INVENTORY.md` updated for any added fixture, lint passes, and the e2e/vitest suites pass. `xstockstrat-ui` has no numeric coverage threshold (spec-template.md table) — existing E2E coverage applies.

---

### Step 17 — docs: promote AC-4 + budget-refund into a marketdata acceptance suite (C-16)

**Status**: `done`
**Service**: `docs/`
**Files**:
- `services/xstockstrat-marketdata/acceptance/sector-classification.feature` — create

**Reviewers**: none

**TDD**: `N/A (docs)`

**Covers**: `—`

**Codebase Evidence**:
- design.md:205 directs: "Promote AC-4 (+ a budget-refund scenario) into a new `services/xstockstrat-marketdata/acceptance/sector-classification.feature` in the impl PR" (C-16 promotion). Existing marketdata acceptance suites live under `services/xstockstrat-marketdata/acceptance/*.feature` (recon.md:70-73 references `edgar-fundamentals-enrichment.feature`, `config-secrets-and-scoping.feature`, `fix-ohlcv-chunk-lock-oom.feature`).
- C-16: on launch a feature's scenarios are promoted into the affected services' durable suites; the design records this in the impl PR.

**Instructions**:
1. Create `services/xstockstrat-marketdata/acceptance/sector-classification.feature` with the `@AC-4` FMP-outage read scenario and a budget-refund-on-503 scenario, tagged with `@feature-216` and the relevant `@FR-*`/`@AC-*` tags, mirroring the Gherkin style of the sibling `.feature` files in that directory.
2. Keep the scenarios faithful to `acceptance.feature` (the single source of acceptance truth, C-15) — this is a durable promotion, not a rewrite.

**Verification**:
```
ls services/xstockstrat-marketdata/acceptance/sector-classification.feature
```
File exists and contains the `@AC-4` + budget-refund scenarios tagged `@feature-216`.

---

### Step 18 — docs: refresh touched context files (teardown audit)

**Status**: `done`
**Service**: `docs/`
**Files**:
- (audit only — reconcile any drift introduced in Steps 10/13 to `services/xstockstrat-marketdata/CLAUDE.md`, `services/xstockstrat-agent/CLAUDE.md`, `docs/patterns/config-governance.md`, `docs/runbooks/mcp-tools.md`)

**Reviewers**: none

**TDD**: `N/A (docs)`

**Covers**: `—`

**Codebase Evidence**:
- Root CLAUDE.md § Teardown mandates `/context-forge:context-constitution refresh` (scoped to touched files) as the last step before push, or the equivalent by-hand reconciliation recorded in the PR body if the plugin is unavailable (root CLAUDE.md, ledger `fails.md:670`).

**Instructions**:
1. After Steps 10 and 13 edit context files, run `/context-forge:context-constitution refresh` scoped to the touched files and fix any grounded drift it reports.
2. If the plugin is unavailable, re-read each touched context file against the current code, reconcile drift by hand, and record in the PR body **both** that the plugin was unavailable **and** the manual reconciliation performed (a bare "plugin unavailable" note does not discharge this — `fails.md:670`).

**Verification**:
The context-forge refresh reports no grounded drift for the touched files (or the manual reconciliation is recorded in the PR body).

---

## Deviation Log

Re-spec gate (2026-10-06, sequential mode) — folded into execution, recorded here rather than as
rewritten step bodies:

1. **AC-14 (Steps 11–12)** — instead of threading resolved params separately into
   `_fundamentals_formula_series`, the evaluator computes each component once per distinct
   sector-resolved *component variant* (`StrategyEvaluator._assemble_sector_resolved`) and passes the
   variant through the unchanged `_assemble_component_series`, so builtin, custom-formula,
   fundamentals-formula (AC-14) and benchmark components all get overrides through one seam. Live
   surfaces (readiness ×4 call sites, opportunities ×2, materializer, live loop) resolve the CURRENT
   sector via `GetCurrentSector` and evaluate `sector_params.apply_sector(definition, sector)` — no
   evaluator change on the live path. `GetIndicatorSeries` (chart) is intentionally not
   sector-resolved (display surface, not a decision surface).
2. **RPC shape (Step 1)** — `GetCurrentSectorRequest` / `GetSectorHistoryRequest` take
   `repeated string symbols` (batch), so a backtest issues ONE `GetSectorHistory` per run (not per
   symbol); `GetSectorAsOf` stays single-symbol.
3. **Migration 007 (Step 3)** — natural PK `(symbol, valid_from)` instead of a surrogate id (no
   surrogate idiom exists in marketdata migrations); the PK serves as-of reads, so the separate
   as-of index was dropped. Partial-unique open-row index unchanged.
4. **FMP client ownership (Step 4)** — the provider default is `finnhub`, so a fundamentals-only
   FMP client would not exist for classification; `main.go` now always builds ONE `*fmp.Client`
   (`newFMPClient`) shared by the fundamentals source (when provider=fmp), enrichment and
   classification. Limiter carries 2% headroom so dispatch jitter never lets rps+1 calls land in one
   vendor second (AC-1 test).
5. **Validation (Step 11)** — `validate_overrides` lives in `_validate_definition` (both write
   paths) and checks component existence / non-fundamental kind / duplicates / sector uniqueness /
   finiteness; it does not require the param key to pre-exist in `params` (formula params may be
   implicit defaults). Warm-up prefix sizes for the hungriest sector variant (`warmup.py`).
6. **AC wording (C-15 amendment, operator-approved)** — @AC-6/7/8/10/13 reworded from an "RSI
   oversold threshold" (a rule rhs literal) to the RSI component `period` param.
7. **UI (Step 15)** — `formulaReference.ts` no longer exists; the exhaustive `Record<Sector,…>` map
   is the new `src/lib/sectors.ts` `SECTOR_LABEL`. Seed-span warning needed no UI change (the
   existing `backtest-warnings` card renders `BacktestResult.warnings`).
9. **Migration renumbered 007 → 009** (2026-10-06, post-review) — feature 223 merged first with
   `008_fundamentals_history_derivation_version`; golang-migrate never applies a version below the
   current one, so `007` would have been silently skipped on any environment already at 008.
   `007` is intentionally left unused. Step 3's body still says 007 (immutable step text).
8. **Verification fallbacks** — Docker Hub rate-limited (`429`) the codegen image, so stubs were
   generated host-native with the CI-pinned toolchain (empty `git diff` baseline proven first);
   `golangci-lint` v2.13.1 built with go1.27. Playwright ran host-native (`--no-deps`); the
   pre-existing `strategy-authoring.spec.ts` "Edit navigates" test fails identically on the base
   tree (not this feature).
