# Implementation Spec: filter-otc-symbols

**Status**: `pending`
**Created**: 2026-11-01
**Feature**: `docs/roadmap/features/282-filter-otc-symbols/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/filter-otc-symbols`

---

## Execution Summary

Proto first (Steps 1-2: `common.v1.UnservableReason`, `marketdata.v1.GetSymbolServability`, `portfolio.v1.RefusedSymbol` + `refused_symbols`), then the two new config keys and the `portfolio.watchlist.max_symbols_per_list` ceiling at the config write edge (Steps 3-4). Marketdata is built next in two slices: the asset-set predicate, refresher and RPC (Steps 5-6), then the warm-add gate at `GetBars`/`BatchGetBars`/`BatchGetLatestPrice` (Steps 7-8). Portfolio consumes the RPC and refuses per symbol on the three insert paths (Steps 9-10), then the consumer surfaces land separately per C-14: Agent (Steps 11-12) and UI (Steps 13-14). Steps 5 and 9 also land config seed migrations 038 and 039 with their readers. Step 15 is docs (runbook, agent, config-governance). Step 16 parse-tests the 038/039 seeds through a shared helper and converts 281's 037 seed test to it. Step 17 is the marketdata and portfolio `CLAUDE.md` files and constitutions with the teardown.

Consumer surfaces (C-14): UI `/insights` (Step 13: `WatchlistDetail`, screener save-as and Add top N, rename via masked update) and Agent (Step 11: `manage_watchlist_symbols`, `manage_watchlist`, `ingest_signal`). No new page or route, so C-10(a) nav registration is not triggered. No new env var or port: the two keys are config keys, so `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` are untouched. No schema migration (the asset set is in memory). The two new keys are seeded by config migrations `038_marketdata_asset_refresh_interval` (Step 5) and `039_portfolio_servability_timeout` (Step 9) and parse-tested in Step 16.

C-16 business-rule changes (signed off in `context.md`, rounds 1 and 3) are promoted into the durable suites at launch by the `/sdd-execute` integration PR, not by a step here: CHANGE `@AC-5 @feature-148` and `@AC-1 @feature-127`; EXTEND `@AC-53/@AC-54 @feature-240`, `@AC-4/@AC-7 @feature-148`, `@AC-7/@AC-10 @feature-170`, `@AC-5 @feature-127`. EXTEND the durable config seed rules `@AC-1/@AC-2/@AC-4 @feature-182` (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature:38,49,58`) and `@AC-1/@AC-2 @feature-184` (`opportunity-config-operability.feature:14,22`) with `@AC-27`. PRESERVE `@AC-19 @feature-281`, which Step 16 converts without changing an assertion. Until 281 launches it lives in `docs/roadmap/features/281-signal-watchlist-expiry-pruning/acceptance.feature:164`; after launch the expected home is `services/xstockstrat-config/acceptance/signal-watchlist-expiry-pruning.feature`. Confirm at promotion with `grep -rln '@AC-19 @feature-281' services/*/acceptance docs/sdd/business-rules`.

### Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| AC-1 | 6 |
| AC-2 | 10 |
| AC-3 | 10 |
| AC-4 | 6, 8 |
| AC-5 | 12 |
| AC-6 | 10 |
| AC-7 | 6, 8, 10 |
| AC-8 | 10 |
| AC-9 | 6 |
| AC-10 | 6 |
| AC-11 | 6 |
| AC-12 | 8 |
| AC-13 | 8 |
| AC-14 | 8 |
| AC-15 | 6 |
| AC-16 | 8 |
| AC-17 | 8, 10 |
| AC-18 | 12 |
| AC-19 | 10, 12 |
| AC-20 | 14 |
| AC-21 | 14 |
| AC-22 | 4, 6, 10 |
| AC-23 | 6, 8 |
| AC-24 | 4, 6 |
| AC-25 | 10 |
| AC-26 | 8 |
| AC-27 | 16 |

## Step Dependencies

- Step 2 requires Step 1: regenerated stubs come from the edited `.proto` files.
- Steps 5, 9, 11 and 13 require Step 2: they compile against `UnservableReason`, `GetSymbolServability`, `RefusedSymbol`.
- Step 4 [test] covers Step 3 [service]; Step 6 [test] covers Step 5; Step 8 [test] covers Step 7; Step 10 [test] covers Step 9; Step 12 [test] covers Step 11; Step 14 [test] covers Step 13. Each test step is authored to fail against the pre-implementation tree (P-06). Step 16 [test] covers the config migrations of Steps 5 and 9 (038, 039). Its RED is recorded by moving both pairs aside, because they land before it.
- Step 7 requires Step 5: `markWarmIfServable`, the snapshot, `(*assetSet).servable` and `liveFetchAllowed` all live in `asset_servability.go` (Step 5's Files); Step 7 only calls them from `marketdata_service.go`.
- Step 9 requires Step 5 only at runtime (portfolio calls the RPC); at compile time it needs Step 2.
- Step 8 and Step 6 both consume the marketdata asset fixtures: the fixture home `internal/testdata/assets.go` is created in Step 6 (C-13: Step 8 is the known second consumer, so the literal is centralized up front rather than copied).
- Step 15 requires Steps 3 and 11 (documents the registered keys and the agent surface). Step 16 requires Steps 5 and 9 (281 is already merged before execution starts; it imports 281's `migrationSql.ts`). Step 17 requires Steps 3, 5, 9 and 15 (documents the marketdata and portfolio behavior) and ends with the CLAUDE.md teardown (`/context-forge:context-constitution refresh`, scoped to every touched context file) as the last step before pushing.
- Merge order: a soft row after `block-fundamentals-strategy-on-etf` (215), and a **Hard** row after `signal-watchlist-expiry-pruning` (281): config migrations 038/039 must sort above 281's 037, and Step 16 imports 281's helper. 282 rebases onto 281 on `AddWatchlistSymbols`, agent `client.add_watchlist_symbol` / `ingest_signal`, and the shared docs; Steps 9 and 11 re-anchor their cited lines after 281 lands and must keep the servability filter ahead of 281's expiry write. 282 re-anchors its `marketdata.proto` and `marketdata_service.go` line references after 215 lands (design R10). Step 5 Verification block 2 runs before the integration PR opens and again immediately before it merges (Step 9 § Merge-time re-check); it also requires feature 280's config `035_smoke_rpc_user_id` / `036_smoke_writes_enabled` (PR #1359) on `origin/main-dev`. 282's sequential run starts only after 281's integration PR is on `main-dev`.
- Decisions resolved by the impl-spec review (operator, 2026-11-01): (a) agent `refused` key is always present on create/add/replace-update responses and `watchlist_refused` on `ingest_signal` only when non-empty (stable `{signal_id, deduplicated}` shape); (b) `portfolio.watchlist.max_symbols_per_list` gets a write-edge bound `[1,1000]` (Step 3) so a within-cap request can never exceed the RPC's 1000-symbol bound; portfolio adds no client-side constant, and an oversized `AddWatchlistSymbols` that reaches the RPC fails open but is then rejected by the cap anyway (union > cap); (c) the registry bound `[1,24]` for `marketdata.assets.refresh_interval_hours` rejects `0` at `SetConfig`, so "`<= 0` pauses" is a reader-only defence (AC-24 is tested at the reader). The design's helper name `servabilityFor` is implemented as `refuseUnservable` (Step 9).

---

### Step 1 — proto: UnservableReason enum, GetSymbolServability RPC, RefusedSymbol

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/common/v1/common.proto` — modify
- `packages/proto/marketdata/v1/marketdata.proto` — modify
- `packages/proto/portfolio/v1/portfolio.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint` / `buf breaking`; Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency; Service owner `xstockstrat-portfolio` — P&L calculation accuracy, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `sed -n 118,145p packages/proto/common/v1/common.proto` — last definitions are `enum TemplateOperation` (zero value `TEMPLATE_OPERATION_UNSPECIFIED = 0`) and messages `TemplateMeta` / `TemplateOrigin` (file ends after `TemplateOrigin`, ~L143); `common.v1.Asset{symbol=1, exchange=2, asset_class=3}` at `:35-39` stays unchanged.
- Confirmed via: `grep -n "SymbolServability\|RefusedSymbol\|UnservableReason" -r packages/proto --include=*.proto` → no matches (names are free).
- `packages/proto/marketdata/v1/marketdata.proto:72` is `rpc GetEtfFlags(GetEtfFlagsRequest) returns (GetEtfFlagsResponse);` closing the service block at `:73`; `GetEtfFlagsRequest{repeated string symbols = 1}` / `EtfFlag{symbol=1, optional bool is_etf=2}` / `GetEtfFlagsResponse{repeated EtfFlag flags=1}` at the end of the file (`:396-407`); the file already imports `common/v1/common.proto` (`:8`).
- `packages/proto/portfolio/v1/portfolio.proto`: `CreateWatchlistResponse{Watchlist watchlist = 1}` (~L283), `UpdateWatchlistResponse` (~L319), `AddWatchlistSymbolsResponse` (~L334); field 2 is free on each; file imports `common/v1/common.proto` (`:9`).
- `packages/proto/buf.yaml` lints `STANDARD` minus `PACKAGE_DIRECTORY_MATCH`, `RPC_RESPONSE_STANDARD_NAME`, `RPC_REQUEST_RESPONSE_UNIQUE`.

**TDD**: `N/A (proto contract; verified by buf lint/breaking and by the compile and tests of Steps 5-14)`

**Covers**: —

**Instructions**:
1. `common.proto`: append `enum UnservableReason { UNSERVABLE_REASON_UNSPECIFIED = 0; UNSERVABLE_REASON_OTC = 1; UNSERVABLE_REASON_NOT_TRADABLE = 2; }` with a comment: why a symbol is unservable; owned by marketdata, never re-derived from `Asset.exchange` by callers. Do not touch `Asset`.
2. `marketdata.proto`: add `rpc GetSymbolServability(GetSymbolServabilityRequest) returns (GetSymbolServabilityResponse);` directly after `GetEtfFlags` inside the service (comment: reads the in-memory asset set only, never calls Alpaca on the request path; request bounded to 1000 symbols, larger is `InvalidArgument`; an unloaded set answers `asset_set_loaded=false` with every symbol servable). Append messages at the end of the file:
   - `GetSymbolServabilityRequest { repeated string symbols = 1; }`
   - `SymbolServability { string symbol = 1; bool servable = 2; xstockstrat.common.v1.UnservableReason reason = 3; }` (reason `UNSPECIFIED` when servable)
   - `GetSymbolServabilityResponse { repeated SymbolServability symbols = 1; bool asset_set_loaded = 2; }`
3. `portfolio.proto`: add `message RefusedSymbol { string symbol = 1; xstockstrat.common.v1.UnservableReason reason = 2; }` before `CreateWatchlistRequest`'s section (near `WatchlistBinding`, ~L243), and add `repeated RefusedSymbol refused_symbols = 2;` to `CreateWatchlistResponse`, `UpdateWatchlistResponse` and `AddWatchlistSymbolsResponse` with a comment: symbols not newly added because unservable; the rest were stored.
4. All changes additive: no renumbering, no removal.

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking . --against "../../.git#branch=origin/main-dev,subdir=packages/proto"
```
(Same invocation shape as CI `buf breaking`: run from `packages/proto`, compare against the target branch with `subdir`. It must report no findings; run `git fetch origin main-dev` first.)

---

### Step 2 — proto-gen: regenerate Go, Python and TypeScript stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/common/v1/common.pb.go` — modify (generated)
- `packages/proto/gen/go/marketdata/v1/marketdata.pb.go`, `marketdata_grpc.pb.go`, `marketdatav1connect/marketdata.connect.go` — modify (generated)
- `packages/proto/gen/go/portfolio/v1/portfolio.pb.go`, `portfolio_grpc.pb.go`, `portfoliov1connect/portfolio.connect.go` — modify (generated)
- `packages/proto/gen/python/common/v1/common_pb2.py`, `packages/proto/gen/python/marketdata/v1/marketdata_pb2.py`, `marketdata_pb2_grpc.py`, `packages/proto/gen/python/portfolio/v1/portfolio_pb2.py` — modify (generated)
- `packages/proto/gen/ts/common/v1/common.ts`, `common_pb.ts`; `packages/proto/gen/ts/marketdata/v1/marketdata.ts`, `marketdata_connect.ts`, `marketdata_pb.ts`; `packages/proto/gen/ts/portfolio/v1/portfolio.ts`, `portfolio_connect.ts`, `portfolio_pb.ts` — modify (generated)
- `packages/proto/gen/ts/dist/{common,marketdata,portfolio}/v1/` — the compiled `common`, `common_pb`, `marketdata`, `marketdata_pb`, `portfolio`, `portfolio_pb` pairs of `.js` and `.d.ts` — modify (generated by `./scripts/buf-gen.sh`)

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint` / `buf breaking`; Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency; Service owner `xstockstrat-portfolio` — P&L calculation accuracy, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `ls packages/proto/gen/go/marketdata/v1 packages/proto/gen/python/marketdata/v1 packages/proto/gen/ts/marketdata/v1` → the three language trees exist and are checked in (root `CLAUDE.md` § Generating Proto Stubs; CI `proto-freshness` enforces a clean diff).
- Generated stubs are never hand-edited (root `CLAUDE.md` § Key File Paths Reference).
- The marketdata tree stays green after regeneration: `grpcMarketDataAdapter` embeds `marketdatav1.UnimplementedMarketDataServiceServer` (`internal/handler/marketdata_handler.go:299-302`) and the Connect handler embeds `marketdatav1connect.UnimplementedMarketDataServiceHandler`, so the new method is satisfied until Step 5 implements it. No F-05 gap between Steps 2 and 5.

**TDD**: `N/A (generated code)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root (toolchain provisioning, if Docker is unavailable: `docs/runbooks/codegen-toolchain-host-setup.md`).
2. Commit the generated output only; do not edit it by hand.
3. Confirm the generated Go `MarketDataServiceClient` interface gained `GetSymbolServability`; the portfolio test stub `stubMarketData` (`services/xstockstrat-portfolio/internal/service/portfolio_service_test.go:18`) and the trading stub (`trading_sizing_test.go:32`) embed the interface, so they still compile.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen | head -20
(cd services/xstockstrat-marketdata && GOWORK=off go build ./...)   # must succeed: the adapter/handler embed the Unimplemented* types
grep -n "UNSERVABLE_REASON_OTC" packages/proto/gen/go/common/v1/common.pb.go packages/proto/gen/python/common/v1/common_pb2.py packages/proto/gen/ts/common/v1/common_pb.ts
# freshness: stage the first run, regenerate, and require no further change
git add -A packages/proto/gen && ./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen && [ -z "$(git ls-files --others --exclude-standard packages/proto/gen)" ]
```
Run from the repo root. The last line must exit 0: a second `./scripts/buf-gen.sh` run produces no diff and no untracked file (CI `proto-freshness`).

---

### Step 3 — service: config write-edge bounds for the two new keys and the symbols-per-list ceiling

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "SCALAR_BOUNDS_REGISTRY" services/xstockstrat-config/src/grpc/configServiceImpl.ts` → registry at `:103`; sibling entry `'portfolio.marketdata.quote_timeout_ms': { minValue: 500, maxValue: 8000 }` at `:139`; `lookupScalarBounds` `:154-155` probes the bare `key` then `${namespace}.${key}`; enforced in `SetConfig` at `:557-563`.
- Neither new key exists: `grep -rn "marketdata.assets.refresh_interval_hours\|portfolio.marketdata.servability_timeout_ms" services docs --include=*.ts --include=*.go --include=*.md` → only this feature's own docs.
- Both new keys are **seeded** by config migrations that land with their readers: `038_marketdata_asset_refresh_interval` in Step 5 and `039_portfolio_servability_timeout` in Step 9 (operator 2026-11-02). The feature-227 waiver (`docs/patterns/config-governance.md:144,155,169`) no longer applies, because 278's shrink-only `config-wiring` ratchet forbids a baseline entry. `SCALAR_BOUNDS_REGISTRY` validates writes only, never a migration INSERT, so these entries are still required; the seeded 6 and 2000 are inside them.
- Existing key `portfolio.watchlist.max_symbols_per_list` (seeded by `services/xstockstrat-config/migrations/006_watchlist_config.up.sql`, default `500`; read live by `maxSymbolsPerList()` at `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1872`) has **no** registry entry today (`grep -n "max_symbols_per_list" services/xstockstrat-config/src/grpc/configServiceImpl.ts` → none). Staging holds `500` (`get_config portfolio watchlist.max_symbols_per_list`, 2026-11-01), within the new bound. The registry lookup probes `${namespace}.${key}` = `portfolio.watchlist.max_symbols_per_list` for the stored `(portfolio, watchlist.max_symbols_per_list)` row (`:154-155`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `SCALAR_BOUNDS_REGISTRY` add, with a one-line comment citing feature 282 (24h ceiling stays below the 48h `minIngestLookback`; the portfolio timeout floor/ceiling keeps the check cheap relative to the 4000ms quote deadline):
   - `'marketdata.assets.refresh_interval_hours': { minValue: 1, maxValue: 24 },`
   - `'portfolio.marketdata.servability_timeout_ms': { minValue: 500, maxValue: 4000 },`
   - `'portfolio.watchlist.max_symbols_per_list': { minValue: 1, maxValue: 1000 },` (comment: ceiling equals marketdata's `GetSymbolServability` request bound of 1000, so a within-cap watchlist request can never exceed it and silently fail open).
2. No other change in this file. The registry is write-edge only; readers clamp on read in Steps 5 and 9.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```

---

### Step 4 — test: SetConfig bounds for the two new keys

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming, scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "TIMEOUT_KEY_FORMS" services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` → table at `:~270-292` of `{ ns, key, field, min, max }` rows covering both key-column forms (bare and full-dotted), e.g. `{ ns: 'portfolio', key: 'marketdata.quote_timeout_ms', ... }` and `{ ns: 'portfolio', key: 'portfolio.marketdata.quote_timeout_ms', ... }`; the loop at `:~295` generates an in-bounds accept test and a just-outside reject test per row.

**TDD**: `red-green required` (run against the tree before Step 3: the out-of-range cases are accepted because the keys are unbounded, so the reject tests fail)

**Covers**: `AC-22, AC-24`

**Instructions**:
1. Append six rows to `TIMEOUT_KEY_FORMS`, mirroring the existing two-forms-per-key convention:
   - `{ ns: 'marketdata', key: 'assets.refresh_interval_hours', field: 'intVal', min: 1, max: 24 }`
   - `{ ns: 'marketdata', key: 'marketdata.assets.refresh_interval_hours', field: 'intVal', min: 1, max: 24 }`
   - `{ ns: 'portfolio', key: 'marketdata.servability_timeout_ms', field: 'intVal', min: 500, max: 4000 }`
   - `{ ns: 'portfolio', key: 'portfolio.marketdata.servability_timeout_ms', field: 'intVal', min: 500, max: 4000 }`
   - `{ ns: 'portfolio', key: 'watchlist.max_symbols_per_list', field: 'intVal', min: 1, max: 1000 }`
   - `{ ns: 'portfolio', key: 'portfolio.watchlist.max_symbols_per_list', field: 'intVal', min: 1, max: 1000 }`
2. Update the comment above the table to name feature 282.
3. C-13 (Node): no new domain literal; rows extend the existing table (single consumer), so no fixture is created.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
```
(Step 3 and this step run together; coverage ≥ 40%.)

---

### Step 5 — service: marketdata asset set, GetSymbolServability RPC, refresher

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/asset_servability.go` — create
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify (struct field only)
- `services/xstockstrat-marketdata/internal/handler/marketdata_handler.go` — modify (Connect handler + gRPC adapter method)
- `services/xstockstrat-marketdata/cmd/server/main.go` — modify (start the refresher)
- `services/xstockstrat-config/migrations/038_marketdata_asset_refresh_interval.up.sql` — create
- `services/xstockstrat-config/migrations/038_marketdata_asset_refresh_interval.down.sql` — create

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency. Service owner `xstockstrat-config` + config team — new global key seed (naming, `value_type`, environment/global scoping). DBA — config migration number `038`, the up+down pair, and a down limited to global rows (`user_id IS NULL`).

**Codebase Evidence**:
- **Why one step (reviewer warning: 6 files, 15 instructions):** migration `038` seeds `marketdata.assets.refresh_interval_hours`, and the CI config-wiring check fails a seeded key with no reader or a read key with no seed (`seeded-unread` / `read-unseeded` in `scripts/check-config-wiring.mjs`), so the seed and `resolveAssetRefreshInterval` must land in the same commit; the handler/adapter method and the refresher start in `main.go` are the reader's only callers. Splitting would leave an intermediate commit that CI rejects.
- Source path: `MarketDataService.ListAssets` calls `s.registry.Get("")` then `src.ListAssets(ctx, req.AssetClass)` — `marketdata_service.go:1353-1363`; `source.DataSourceClient.ListAssets` `internal/source/source.go:18`; `Registry.Get("")` resolves `"alpaca"` `source.go:172-181`. `alpaca.Client.ListAssets` sends `status=active` (`internal/alpaca/client.go:521`) and skips `!a.Tradable` (`:548`); `asset_class` is appended when non-empty (`:522-524`). Reusing this path means `DataSourceClient` gains no method and the six test fakes (`fakeBackfillSource` `marketdata_service_test.go:900`, etc.) are untouched.
- Cache and poller templates: `etfFlagState` `internal/service/etf_flags.go:33-148` (mutex + map + `now` seam), `GetEtfFlags` batch-in/per-symbol-out `:62-78`; `StartClassificationRefreshPoller` `classification_service.go:224-247` (1-minute ticker, re-reads the interval each tick, `hours <= 0` → `continue`); `normalizeSymbols` (uppercase + trim, drops empties) `classification_service.go:97`.
- Config seam: `budgetCfg intGetter` (`marketdata_service.go:102`, set only when the watcher is non-nil at `:230-232`); `resolvePositiveInt` (`:986-993`) maps `<= 0` to the default, so it cannot express the "`<= 0` pauses" rule (MARKETDATA-5) — this step reads `s.budgetCfg.GetInt` directly. `config.Watcher.GetInt` returns the default when the key is unset (`internal/config/config.go:157-168`).
- Warm set: `warmMu`/`warmSymbols` `marketdata_service.go:47-50`; `markWarm` `:1088-1095` (does not normalize); `warmSnapshot` `:1099`; `StartWarmQuotePoller` copies `s.warmSymbols` inline `:1132-1137`.
- Handler pattern: `MarketDataHandler.GetEtfFlags` returns the service error unwrapped so connect codes survive (`marketdata_handler.go:159-167`); gRPC adapter `GetEtfFlags` `:360-366` maps via `toGRPCError`, which maps `connect.CodeInvalidArgument` → `codes.InvalidArgument` (`:496-515`). Handler embeds `marketdatav1connect.UnimplementedMarketDataServiceHandler` (`:19-23`).
- Startup wiring: pollers started with `go svc.Start…(ctx)` at `cmd/server/main.go:164-172`.
- Header propagation: no outbound gRPC added (Alpaca REST only), so C-03 is not triggered by this step.
- Feature 278 checker:
  - `GETTER_RE` matches any `.GetInt(` call (`scripts/check-config-wiring.mjs:381`).
  - Constant resolution: `goConsts` (`:471-482`; the block form is `const (` alone on its line and `)` at column 0) and `resolveIdent` (`:490-507`; same file, then same directory, then service-wide; an ambiguous name is unresolved).
  - A seed counts as wired only when its stored key equals the read string (`:625`).
  - `declaredFromSpec` declares every backticked dotted token under `## Config Key Changes` (`:651-662`). `declaredFromMigration` parses the INSERT (`:664-673`).
  - Step-time mode prints `PENDING` for missing-side findings (`:706`).
  - `--json` writes `{findings, results, counts}` (`:743`); each finding is `{kind, namespace, key, file}` plus `readKey` on a `form-mismatch` (`join`, `:607-643`). Baseline entries in `scripts/config-wiring.json` carry no `file` (`sameId`, `:679`), so a reader-file identity is checked against the raw `--final --json` base findings, never against the baseline file. A `read-unseeded` finding is attributed to the lexicographically smallest runtime reader file (`:609`, `:637`); a `dynamic-read` finding's identity is per enclosing symbol (`:641-642`).
- Config migrations on `main-dev` end at `034_retire_portfolio_snapshot_interval`. Feature 281's seed is `037_portfolio_signal_prune_interval` and is on `main-dev` before this run starts (merge-order row 92, Variant L), so 282 takes `038`/`039`. Feature 280 (PR #1359) no longer holds 035/036 ahead of us: it depends on 281 and renumbers above the highest config migration at its merge time (merge-order.md, operator 2026-11-04); if it lands first with 038+, block 2 below STOPs and 282 re-specs its numbers.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `asset_servability.go` (new, package `service`). Fixed operator-approved invariants as unexported consts (F-07 precedent, recorded in `design.md`): `assetClassUSEquity = "us_equity"`, `assetExchangeOTC = "OTC"`, `assetShrinkKeepPercent = 50`, `assetRetryInitial = time.Minute`, `assetRetryMax = 30 * time.Minute`, `servabilityMaxSymbols = 1000`, `defaultAssetRefreshHours = 6`, `maxAssetRefreshHours = 24`, and the config key const `assetRefreshHoursKey = "marketdata.assets.refresh_interval_hours"`.
2. `type assetSet struct { otc map[string]bool }` (immutable after construction; normalized symbol → exchange is OTC). Constructor `newAssetSet(assets []*commonv1.Asset) *assetSet` (uppercase/trim symbol; `otc = strings.EqualFold(exchange, assetExchangeOTC)`). Method `(a *assetSet) classify(sym string) (servable bool, reason commonv1.UnservableReason)`: normalize (uppercase+trim); absent → `(false, UNSERVABLE_REASON_NOT_TRADABLE)`; present and OTC → `(false, UNSERVABLE_REASON_OTC)`; else `(true, UNSERVABLE_REASON_UNSPECIFIED)`. A nil `*assetSet` receiver returns servable (fail open). Add `(a *assetSet) servable(sym string) bool` (nil-safe, over `classify`) and the package function `liveFetchAllowed(snap *assetSet, sym string) bool` (`snap == nil` → true, else `snap.servable(sym)`): the single place Step 7 and its tests ask "may this symbol be live-fetched?" (AC-4/AC-7/AC-23 behavioural seam).
3. `type assetServabilityState struct { snap atomic.Pointer[assetSet]; unloadedWarned bool }` (`unloadedWarned` is touched only by the refresher goroutine). Add field `assets assetServabilityState` to `MarketDataService` (`marketdata_service.go`, next to `etf etfFlagState` at `:~96`) so existing struct literals in tests keep a usable zero value (nil snapshot = servable).
4. `(s *MarketDataService) markWarmIfServable(symbols ...string) *assetSet`: take `warmMu`, **load the snapshot while holding the lock**, add each non-empty symbol to `warmSymbols` unless the snapshot is non-nil and marks it unservable, release, return the snapshot (the caller's live-fetch decision reuses it — one snapshot, one predicate per request). Do not change `markWarm` (the quote and price paths keep using it). Put this comment at the definition and nowhere else: "gate applies at warm-add sites only; warm-set readers are never filtered".
5. `(s *MarketDataService) GetSymbolServability(ctx, req *marketdatav1.GetSymbolServabilityRequest) (*marketdatav1.GetSymbolServabilityResponse, error)`: `len(req.GetSymbols()) > servabilityMaxSymbols` → `connect.NewError(connect.CodeInvalidArgument, …)`; normalize via `normalizeSymbols`; one snapshot load; for a nil snapshot return `AssetSetLoaded=false` with every symbol `Servable=true`; otherwise per-symbol `{Symbol, Servable, Reason}` via `classify`, `AssetSetLoaded=true`. In-memory only (no DB, no Alpaca call — feature 153 `@AC-1`).
6. `(s *MarketDataService) refreshAssets(ctx) error`: `src, err := s.registry.Get("")`; `assets, err := src.ListAssets(ctx, assetClassUSEquity)`; build `next := newAssetSet(assets)`; **reject** (return error, keep the last good set, log WARN with old/new counts) when `len(next.otc) == 0`, or when a prior snapshot exists and `len(next.otc)*100 < len(prev.otc)*assetShrinkKeepPercent`; the very first load has no prior set so the shrink guard does not protect it (design R3). On accept: `s.assets.snap.Store(next)`; on the **first** successful load only, take `warmMu` and delete every `warmSymbols` entry for which `next.classify(sym)` is unservable (path-agnostic), release, and log one INFO `asset set loaded` (count, pruned). No later refresh prunes (design R2).
7. `(s *MarketDataService) StartAssetSetRefresher(ctx)`: run `refreshAssets` immediately at boot (do not wait a tick); on the first failure while still unloaded log exactly one WARN (`asset set unavailable; treating every symbol as servable`) via `(s *MarketDataService) noteAssetRefreshFailure(ctx, err)` (owns `unloadedWarned`; called by the loop on every failed attempt, so Step 6 can call it directly), then rely on backoff. Then loop on a 1-minute `time.Ticker` (MARKETDATA-5, mirrors `StartClassificationRefreshPoller`): each tick re-read `resolveAssetRefreshInterval(s.budgetCfg)`; interval `0` (paused) → `continue`; run `refreshAssets` when `time.Since(lastSuccess) >= interval` (or the retry deadline has passed); on failure advance the delay with the pure function `nextAssetRetryDelay(cur time.Duration) time.Duration` (`0` → `assetRetryInitial`; else `min(cur*2, assetRetryMax)`), on success reset it to `0`. `refreshAssets`, `noteAssetRefreshFailure` and `nextAssetRetryDelay` are the test seams: the ticker loop itself needs no tests that sleep. Runs on the long-lived `main` ctx (background work carries no propagation headers by design).
8. `resolveAssetRefreshInterval(cfg intGetter) time.Duration`: nil cfg → `defaultAssetRefreshHours` hours; `v := cfg.GetInt(assetRefreshHoursKey, defaultAssetRefreshHours)`, called directly with the const shape in Instruction 12; `v <= 0` → `0` (paused, keep the set); `v > maxAssetRefreshHours` → 24h; else `v` hours.
9. `marketdata_handler.go`: add `(h *MarketDataHandler) GetSymbolServability` (copy the `GetEtfFlags` shape: return the service error unwrapped) after `GetEtfFlags` (`:159-167`) and `(a *grpcMarketDataAdapter) GetSymbolServability` after `:360-366`.
10. `cmd/server/main.go`: add `go svc.StartAssetSetRefresher(ctx)` after `go svc.StartEtfFlagFiller(ctx)` (`:166`).
11. Dry-run check: reuse `normalizeSymbols`; do not copy `etfFlagState`'s TTL/eviction machinery (no TTL, no per-entry state needed — one immutable snapshot).
12. **Const shape.** `assetRefreshHoursKey = "marketdata.assets.refresh_interval_hours"` is a member line of Instruction 1's `const (` block.
    - The block opens with `const (` alone on its line and closes with `)` at column 0.
    - The value is a double-quoted literal with nothing after the closing quote.
    - The name has exactly one value in `services/xstockstrat-marketdata`.
    - Instruction 8's call is the only read. Add no wrapper that takes the key as a parameter: 278 would report it as `dynamic-read`, or 038 would show as `seeded-unread`.
13. **Seed in this same commit.** Create the 038 pair with exactly the SQL in `design.md` § Amendment 2026-11-02.
    - Never commit the seed before the reader (`seeded-unread`).
    - Never commit the reader without the seed (`read-unseeded`).
    - Do not edit `scripts/config-wiring.json`.
14. **Collision check, before writing the pair.** Run Verification block 2.
    - `STOP` or `FAIL`: raise a §5.7 blocker, and never pick a number yourself.
    - If the operator approves a renumber:
      1. Answer the blocker with the free text `stop here`. Run the SESSION-END SUMMARY (the same path as checkpoint `stop here`, `sequential-mode.md:141-142`) and record the stop in `context.md`.
      2. Resume with `/sdd-execute filter-otc-symbols(re-spec Steps 5-16 first) sequential`. The documented explicit directive takes one `Steps X-Y` range or one `Step N` (`sequential-mode.md:18`), so the range spans every step that hard-codes the numbers (5, 9 and 16); the re-spec changes only those numbers and never the EREA order of Steps 9-10. §5.3 rewrites every hard-coded `038_`/`039_` (block 2 `OURS` and its `03[89]_` other-ref grep, block 3, block 4 `UP`, Step 9's block 3/4 values, Step 16's RED `mv`). If a renamed pair is already committed, its `git mv` goes into the first pending re-specced step's **Files**.
      3. Afterwards, `git grep -nE '[0-9]{3}_(marketdata_asset_refresh_interval|portfolio_servability_timeout)' docs/roadmap/features/282-filter-otc-symbols` must show only the new numbers.
    - Never rename through the Deviation Log: the shell blocks hard-code the numbers (F-08, F-09).
15. Step-time mode only guards against form mismatches. The wiring proof is block 4.

**Verification** (block 1 is a subshell; run from the repo root before blocks 2–4, which use repo-root paths):
```bash
# 1. build, lint, wiring greps
(cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && grep -n "StartAssetSetRefresher" cmd/server/main.go \
  && grep -nE '^[[:space:]]+assetRefreshHoursKey[[:space:]]*=[[:space:]]*"marketdata\.assets\.refresh_interval_hours"$' internal/service/asset_servability.go \
  && grep -n "GetInt(assetRefreshHoursKey, defaultAssetRefreshHours)" internal/service/asset_servability.go)

# Blocks 2-4: run from the repo root.
# 2. config migration collision check — identical text in Steps 5, 9 and at merge time
(
D=services/xstockstrat-config/migrations
OURS='^(038_marketdata_asset_refresh_interval|039_portfolio_servability_timeout)\.(up|down)\.sql$'
P037='^037_portfolio_signal_prune_interval\.up\.sql$'
git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*' || exit 1
ls_mig() { git ls-tree --name-only "$1" "$D/" 2>/dev/null | sed 's#.*/##'; }
for p in "$P037"; do
  ls_mig origin/main-dev | grep -qE "$p" || { echo "STOP: $p is not on origin/main-dev - feature 281 must merge first"; exit 1; }
  ls "$D" | grep -qE "$p" || { echo "STOP: $p absent from this branch - merge origin/main-dev"; exit 1; }
done
MAIN=$(ls_mig origin/main-dev | grep -E '^[0-9]{3}_' | grep -Ev "$OURS" | awk -F_ '$1+0 >= 38')
OTHER=$(git for-each-ref --format='%(refname)' refs/remotes/origin/ | grep -v '/HEAD$' | while read -r ref; do
  ls_mig "$ref" | grep -E '^03[89]_' | grep -Ev "$OURS" | sed "s#^#${ref#refs/remotes/}: #"
done)
[ -z "$MAIN$OTHER" ] || { printf 'FAIL: config migration 038/039 not free\n%s\n%s\n' "$MAIN" "$OTHER"; exit 1; }
echo "038/039 free; 037 present"
)

# 3. step-time guard (pair present + parse + form-mismatch)
node scripts/check-config-wiring.mjs --declared-from docs/roadmap/features/282-filter-otc-symbols/product-spec.md \
  --declared-migration services/xstockstrat-config/migrations/038_marketdata_asset_refresh_interval.up.sql \
 && [ -f services/xstockstrat-config/migrations/038_marketdata_asset_refresh_interval.down.sql ]

# 4. --final gate vs merge-base baseline (Step 9 reuses this block with K/UP/RD changed)
(
K=marketdata.assets.refresh_interval_hours
UP=services/xstockstrat-config/migrations/038_marketdata_asset_refresh_interval.up.sql
RD=services/xstockstrat-marketdata/internal/service/asset_servability.go
[ -f scripts/check-config-wiring.mjs ] || { echo "FAIL: 278 checker absent - merge origin/main-dev first"; exit 1; }
T=$(mktemp -d "${TMPDIR:-/tmp}/cw282.XXXXXX") || exit 1
trap 'rm -rf "$T"' EXIT
node scripts/check-config-wiring.mjs --final --json >"$T/head.json" 2>"$T/head.err"; rc=$?
[ "$rc" -ne 2 ] || { echo "FAIL: --final rc 2"; cat "$T/head.err"; exit 1; }
MB=$(git merge-base HEAD origin/main-dev) || exit 1
{ mkdir -p "$T/base" && git archive "$MB" | tar -x -C "$T/base"; } || { echo "FAIL: cannot extract base tree"; exit 1; }
[ -f "$T/base/scripts/check-config-wiring.mjs" ] || { echo "STOP: merge-base $MB predates 278 - ask the operator"; exit 1; }
(cd "$T/base" && node scripts/check-config-wiring.mjs --final --json >"$T/base.json" 2>"$T/base.err"); brc=$?
[ "$brc" -ne 2 ] || { echo "STOP: base --final rc 2 at $MB - ask the operator"; cat "$T/base.err"; exit 1; }
node -e '
const fs=require("fs");const [h,b,K,UP,RD]=process.argv.slice(1);
const head=JSON.parse(fs.readFileSync(h,"utf8")),base=JSON.parse(fs.readFileSync(b,"utf8"));
const rdDyn=base.findings.filter(f=>f.file===RD&&f.kind==="dynamic-read");
if(rdDyn.length){rdDyn.forEach(f=>console.log("STOP-RD (merge-base has a dynamic-read on the reader file; its identity is per enclosing symbol - re-spec the hit identity): "+JSON.stringify(f)));process.exit(3);}
const id=f=>JSON.stringify([f.kind,f.namespace,f.key,f.file]);
const left=new Map();base.findings.filter(f=>f.file===RD).forEach(f=>left.set(id(f),(left.get(id(f))||0)+1));
const newOnRd=f=>{const n=left.get(id(f))||0;if(n){left.set(id(f),n-1);return false;}return true;};
const keyHit=f=>f.key===K||f.readKey===K||(f.namespace&&f.namespace+"."+f.key===K)||f.file===UP||(f.file===RD&&newOnRd(f));
const names=l=>l.includes(K)||l.includes(UP);
const baseFail=new Set(base.results.filter(r=>r.fail).map(r=>r.line));
const hits=head.findings.filter(keyHit);
const other=head.results.filter(r=>r.fail&&!names(r.line));
const introduced=other.filter(r=>!baseFail.has(r.line)),pre=other.filter(r=>baseFail.has(r.line));
hits.forEach(f=>console.log("KEY-HIT: "+JSON.stringify(f)));
introduced.forEach(r=>console.log("INTRODUCED: "+r.line));
pre.forEach(r=>console.log("ESCALATE (fails on merge-base too): "+r.line));
console.log("key hits "+hits.length+", introduced "+introduced.length+", pre-existing "+pre.length);
process.exit(hits.length||introduced.length?1:0);' "$T/head.json" "$T/base.json" "$K" "$UP" "$RD"
)
```

**Pass condition:**
- Blocks 1–4 all exit 0, with no `KEY-HIT` and no `INTRODUCED` line.
- `ESCALATE` (block 4) lines do not fail the step. Copy them into `context.md` and raise them at the checkpoint; do not fix or baseline them.
- `STOP` or `STOP-RD` (exit 3) means raise a §5.7 blocker. A `STOP-RD` means the merge-base already has a `dynamic-read` finding on the reader file; its identity is per enclosing symbol, so the multiset comparison below cannot tell an old site from a new one. The operator must re-specify the hit identity.
- Hit predicate: a head finding is a `KEY-HIT` when it names `K` (`key`, `readKey`, or `namespace.key`) or the file `UP`, or when its file is `RD` and it is **new versus the merge-base**, compared as a multiset on `(kind, namespace, key, file)`. This replaces 281's "any finding on `RD`" rule: `portfolio_service.go` is already the attributed reader of three baselined `read-unseeded` keys (`portfolio.marketdata.quote_timeout_ms`, `portfolio.risk.max_drawdown_pct`, `portfolio.risk.concentration_limit_pct`), so that rule would always fire in Step 9. For Step 5 the two rules agree, because `asset_servability.go` is a new file with no base findings. Results lines that name `RD` but not `K`/`UP` are classified `INTRODUCED`/`ESCALATE` against the merge-base like any other.

---

### Step 6 — test: marketdata asset set, servability RPC, refresher semantics

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/asset_servability_test.go` — create
- `services/xstockstrat-marketdata/internal/testdata/assets.go` — create

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- Test conventions: struct-literal service construction with a fake registry source (`newQuoteSvc` `marketdata_service_test.go:3357`, literal `&MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}, budgetCfg: cfg}` at `:3360`); `fakeIntGetter` (`map[string]int64`, `:1921`) / `budgetCfgMs` (`:1944`); `fakeBackfillSource.ListAssets` returns nil (`:911`) so a new fake source with a scripted `ListAssets` is needed; `funcBody` structural helper `:1231`.
- Go fixture home: `services/xstockstrat-marketdata/internal/testdata/marks.go` (package `testdata`, C-13). `etf_flags_test.go` is the closest template for a cache-state test file.
- C-13 verdict: the asset literals (`AAPL`/NASDAQ, `BOSSY`/OTC, `ZZZZ`, DNB absent) have **two consumers** (this step and Step 8), so they live in `internal/testdata/assets.go` from the start.
- From Step 5 on, `marketdata.assets.refresh_interval_hours` is seeded by 038 at 6, which equals `defaultAssetRefreshHours`, so a seeded key and an unset key read the same. An unset key still occurs in a scope with no row, or after the 038 down migration. AC-24's "unset → 6" therefore stays the read-path case (`fakeIntGetter` with the key absent). Because default == seed, a read of the wrong key would also yield 6h, so one seeded-key reader case drives the exact seeded key string with a **non-default** value (12 → 12h); this proves Instruction 8 reads `marketdata.assets.refresh_interval_hours` (config-key wiring (b)).

**TDD**: `red-green required` (fails to compile / assert against the tree before Step 5)

**Covers**: `AC-1, AC-4, AC-7, AC-9, AC-10, AC-11, AC-15, AC-22, AC-23, AC-24`

**Instructions**:
1. `internal/testdata/assets.go`: exported constants for the symbols (`Bossy`, `Crtd`, `Forl`, `Dnb`, `Zzzz`, reuse `Msft` from `marks.go`, add `Aapl` only if absent) and a builder `ServableAssets() []*commonv1.Asset` returning AAPL (`NASDAQ`), MSFT (`NASDAQ`), ZZZZ (`NASDAQ`), BOSSY and CRTD (`OTC`), and `FORL` (`OTC`); DNB deliberately absent. No domain data is declared inline in the test files.
2. `asset_servability_test.go`, one test per scenario, each naming its `@AC-N`:
   - AC-1: `GetSymbolServability` on a loaded set → AAPL servable; BOSSY `UNSERVABLE_REASON_OTC`; DNB `UNSERVABLE_REASON_NOT_TRADABLE`; `AssetSetLoaded == true`.
   - AC-23: `" bossy "` classifies as BOSSY in `GetSymbolServability`, in `classify` and in `servable`.
   - AC-4 / AC-7 (decision half, behavioural): `liveFetchAllowed(snap, "BOSSY")` and `liveFetchAllowed(snap, "DNB")` are false on a loaded set, `liveFetchAllowed(snap, "AAPL")` is true, and `liveFetchAllowed(nil, "BOSSY")` is true (fail open). Step 8 pins that `GetBars` routes its live fetch through this function.
   - AC-22 (marketdata half): 1001 symbols → `connect.CodeOf(err) == connect.CodeInvalidArgument`; exactly 1000 succeeds.
   - AC-9: nil snapshot → `GetSymbolServability` returns `AssetSetLoaded == false` and every symbol servable; `markWarmIfServable("BOSSY")` adds it; `noteAssetRefreshFailure` called five times logs exactly one unloaded WARN (capture with a `slog` handler; assert count == 1).
   - AC-10: after a good load, a `ListAssets` error leaves BOSSY unservable and AAPL servable (`refreshAssets` returns error, snapshot pointer unchanged); assert `nextAssetRetryDelay` goes `0 → 1m → 2m → 4m → … → 30m` and stays capped at 30m (pure function defined in Step 5; no sleeping).
   - AC-11: with a 10-asset set loaded, a refresh returning 4 assets is rejected and a WARN is logged; an empty refresh is rejected the same way; a 5-of-10 refresh (exactly 50%) is accepted.
   - AC-15: warm `BOSSY` and `AAPL` via `markWarm` while unloaded; first successful load that lists AAPL but not BOSSY removes BOSSY and keeps AAPL; a **later** refresh that stops listing AAPL does not remove it from the warm set.
   - AC-24: `resolveAssetRefreshInterval` with a `fakeIntGetter` → `0` → paused (returns 0), `48` → 24h, key unset → 6h, `nil` cfg → 6h.
   - Seeded-key reader (config-key wiring (b)): `TestResolveAssetRefreshInterval_ReadsSeededKey` drives `resolveAssetRefreshInterval(fakeIntGetter{"marketdata.assets.refresh_interval_hours": 12})` and asserts `12 * time.Hour`. Write the key as a literal in the test, not via `assetRefreshHoursKey`, so a wrong const fails it.
3. Use `source.NewRegistry().Register("alpaca", fake)` with a fake whose `ListAssets(ctx, "us_equity")` is scripted and records the asset class it was asked for (assert `"us_equity"`).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/ {gsub("%","",$3); print "total " $3 "%"; if ($3+0 < 40) {print "FAIL: coverage below the 40% CI threshold"; exit 1}}'
grep -rn "Bossy\|BOSSY" --include="*_test.go" internal | head   # C-13: asset literals only via internal/testdata
[ "$(grep -c '^func TestResolveAssetRefreshInterval_ReadsSeededKey(' internal/service/asset_servability_test.go)" -eq 1 ]
```
New logic is in an excluded package (`service/`) — no coverage threshold applies to it; the repo-wide ≥ 40% command above must still pass and these tests provide the behavioral verification.

---

### Step 7 — service: marketdata warm-add gate at GetBars, BatchGetBars, BatchGetLatestPrice

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service.go` — modify

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- `markWarm` call sites confirmed via `grep -n "markWarm" services/xstockstrat-marketdata/internal/service/marketdata_service.go`: `GetBars :263`, `GetLatestQuote :546`, `GetLatestQuotes :576`, `GetLatestPrice :689`, `BatchGetBars :750`, `BatchGetLatestPrice :869` (re-verified 2026-11-04; the other `:NNN` anchors in this step drift with 215's merge, so find them by symbol). Only the first, fifth and sixth are gated; `GetLatestQuote(s)` and `GetLatestPrice` stay on `markWarm` (held positions stay priced, feature 178 `@AC-3`).
- `GetBars`: live-fetch fallback `if pageToken == "" { refetch := len(bars) == 0 … if refetch { … s.fetchAndCacheBars(…) … else if len(bars) == 0 { slog.WarnContext(ctx, "GetBars: no bars stored and live fetch returned none" … } } }` at `:312-332`.
- `BatchGetBars`: `for _, sym := range req.Symbols { s.markWarm(sym) }` at `:748-750`; cold list built from the `warm` map at `:763-768`; singleflight key from `sortedCold` `:770-772`; `partialColdFetch(ctx, key, cold, fetch)` at `:~809` (its WARN prints `cold`); strict path `s.barsSingleflight.Do(key, …)` returns the fetch error.
- `BatchGetLatestPrice`: `markWarm` loop `:867-869`; flight key `"batch-price:" + strings.Join(sorted, ",")` from the full request `:871-874`; previous-close read `GetPreviousDailyCloseBatch(fctx, req.Symbols)` `:893`; trade fetch `GetLatestTradesMulti(fctx, req.Symbols)` `:908-945` with per-symbol fallback over `req.Symbols`; response loop omits a symbol with neither trade nor previous close and leaves `LastPrice`/`LastTradeTime` unset when only a previous close exists `:964-979`.
- Existing structural test that pins the call: `TestGetBarsMarksSymbolWarm` (`marketdata_service_test.go:1111-1121`) source-scans for `s.markWarm(req.Symbol)` — updated in Step 8.
- Analysis consumer never treats a present entry as a live price: `HasField("last_price")` and no memoization of a missing price (`services/xstockstrat-analysis/app/handlers/servicer.py:4788,4803`, per design) — no analysis change.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `GetBars`: replace `s.markWarm(req.Symbol)` (`:262`) with `snap := s.markWarmIfServable(req.Symbol)`. Wrap the existing `if refetch { … }` body (`:312-332`) as `if refetch && liveFetchAllowed(snap, req.Symbol) { … }` (`liveFetchAllowed` and `servable` are defined in Step 5, in `asset_servability.go`; this step edits only `marketdata_service.go`), keeping the inner `slog.WarnContext(ctx, "GetBars: no bars stored and live fetch returned none" …)` text intact. An unservable symbol still gets its stored bars; a miss returns the empty valid `GetBarsResponse` exactly as today, with no live fetch and no WARN (the noise this feature removes).
2. `BatchGetBars`: replace the `markWarm` loop (`:748-750`) with `snap := s.markWarmIfServable(req.Symbols...)`. When building `cold` (`:763-768`) skip any symbol for which `!snap.servable(sym)`, **before** `sortedCold` and the singleflight key. If `cold` ends up empty no flight runs and strict and partial calls succeed with the stored bars only. `partialColdFetch` receives the filtered `cold`, so its WARN does not report unservable symbols.
3. `BatchGetLatestPrice`: replace the `markWarm` loop (`:867-869`) with `snap := s.markWarmIfServable(req.Symbols...)`. Keep the flight key on the **full** sorted request (`:871-874`: callers that differ only in unservable members must not share a leader's previous-close map). Inside the closure compute `tradeSyms` = the subset of `req.Symbols` for which `snap.servable(sym)` holds and use it for both the `GetLatestTradesMulti` call and the per-symbol fallback loop (`:908-945`), skipping the whole trade section when `tradeSyms` is empty; the previous-close read (`:893`) still covers `req.Symbols`. An unservable symbol with a stored previous close is therefore returned with `prev_close` only; one without is omitted (existing omit rule, `:964-979`). `n` in the log fields stays `len(req.Symbols)`.
4. Do not add the gate comment here (it lives at `markWarmIfServable`'s definition, Step 5). Do not touch `warmSnapshot` (`:1099`), the `StartWarmQuotePoller` inline copy (`:1132-1137`), `ingestRecentBars`, or `classificationUniverse`.
5. Header propagation: no outbound gRPC calls added.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
[ "$(grep -c 'markWarmIfServable(' internal/service/marketdata_service.go)" -eq 3 ]   # GetBars, BatchGetBars, BatchGetLatestPrice (definition lives in asset_servability.go)
[ "$(grep -c 'markWarm(' internal/service/marketdata_service.go)" -eq 4 ]   # GetLatestQuote, GetLatestQuotes, GetLatestPrice + the markWarm definition
```
`markWarm(` does not match `markWarmIfServable(`, and the `:255` comment ("before markWarm/DB/live") has no `(`, so the two counts are disjoint.

---

### Step 8 — test: marketdata gate (GetBars, BatchGetBars, BatchGetLatestPrice, ungated paths)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- `TestGetBarsMarksSymbolWarm` (`marketdata_service_test.go:1111-1121`) asserts `s.markWarm(req.Symbol)` in `GetBars`'s body via `funcBody` (`:1231`); `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` (`:1126-1135`) asserts the WARN string stays — both structural because `GetBars` needs a live DB pool.
- f240 fixtures to extend: `fakeBarsStore` serves AAPL's 3 bars (`:4060-4074`), `scriptedBarsSource` counts cold fetches (`:4077`), `partialSvc` builds the service (`:4090-4095`), `batchReq` uses symbols AAPL + MSFT (`:4097`), `hangUntilDone` (`:4105`), `assertOnlyWarmAAPL` (`:4110`), and tests `TestBatchGetBars_AC53_*` / `AC54_*` (`:4120-4146`). Price fakes: `fakeBatchPriceSource` (`:1643`) / `fakeLatestTradeOnlySource` (`:1713`), `TestBatchGetLatestPrice_MultipleSymbols` (`:1741`) with `prevClose prevCloseReader` seam on the service.
- Quote tests: `fakeQuoteStore` (`:3330`) / `newQuoteSvc` (`:3357-3365`) for the ungated quote-path scenario.
- C-13 verdict: asset literals come from `internal/testdata/assets.go` (Step 6), the second consumer; the symbol names `FORL`, `BOSSY`, `ZZZZ` are not redeclared inline.

**TDD**: `red-green required` (run before Step 7: unservable symbols are still warmed and fetched, so the new assertions fail)

**Covers**: `AC-4, AC-7, AC-12, AC-13, AC-14, AC-16, AC-17, AC-23, AC-26`

**Instructions**:
1. Update `TestGetBarsMarksSymbolWarm` to require `s.markWarmIfServable(req.Symbol)` in `GetBars`'s body (and still that the body contains no bare `s.markWarm(`), and extend it with a structural assertion that the `refetch` branch is guarded by `liveFetchAllowed(snap, req.Symbol)` (the behaviour of that function is proven in Step 6; `GetBars` itself needs a live DB pool, so this wiring stays a source scan). Keep `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` passing unchanged.
2. Add `TestMarkWarmIfServable_*`: with a loaded set (`svc.assets.snap.Store(newAssetSet(testdata.ServableAssets()))`) `markWarmIfServable("BOSSY","AAPL")` adds only AAPL and returns the same snapshot (AC-4 warm half, AC-7 for DNB, AC-23 for `" bossy "`); with a nil snapshot both are added.
3. AC-12: new test using `partialSvc`-style construction with the asset set loaded (AAPL, ZZZZ listed; BOSSY not), `barsStore: fakeBarsStore{}`, a source whose cold fetch returns an error and counts calls; `BatchGetBars` for AAPL + BOSSY with `AllowPartial: false` succeeds with AAPL only and 0 live fetches. Also assert a **pinned** variant for R4: with ZZZZ servable in the loaded set, strict still returns the plain source error (`errors.Is(err, errColdFetch)`), so `@AC-53 @feature-240` remains meaningful.
4. AC-14: asset set loaded (AAPL, ZZZZ listed); the cold fetch for ZZZZ blocks (`hangUntilDone`); `BatchGetBars` for AAPL, ZZZZ, BOSSY with `AllowPartial: true` under a 1000ms context deadline returns within the deadline with the stored AAPL bars; the recording source saw `ZZZZ` requested and `BOSSY` not (record the symbols argument of `GetBarsMulti` in a new wrapper type; do not change `scriptedBarsSource`'s existing signature used by other tests). Capture `slog` output in this test and assert the `partialColdFetch` WARN lists ZZZZ and does **not** mention BOSSY (the filtered cold list is what it receives).
5. AC-13: `svc.prevClose` fake with BOSSY previous close 9.9 and no AAPL previous close; `fakeBatchPriceSource` with an AAPL trade only; `BatchGetLatestPrice` for AAPL + BOSSY returns AAPL with `LastPrice`, BOSSY with `PrevClose` set and `LastPrice == nil`, BOSSY not in the warm set, and the source's trade request never contained BOSSY; a symbol with neither is omitted. Also assert the singleflight key is built from the full set (two concurrent calls differing only in an unservable member do not share a previous-close map).
6. AC-16: with BOSSY unservable, `GetLatestQuotes`, `GetLatestQuote` (and `GetLatestPrice` where its fake allows) each add BOSSY to the warm set and their live fetch behaviour is unchanged (BOSSY is requested from the source).
7. AC-17 (marketdata half) and AC-26: warm `FORL` through `GetLatestQuotes` after the asset set is loaded and lists FORL as OTC → it stays warm across a later `refreshAssets` (no prune after first load); and a symbol warmed while unloaded then pruned by the first load is re-added by the next `GetLatestQuotes` call.
8. Use existing fakes; any new helper is private to this file. No new `INVENTORY.md`-style catalog applies (Go).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/ {gsub("%","",$3); print "total " $3 "%"; if ($3+0 < 40) {print "FAIL: coverage below the 40% CI threshold"; exit 1}}'
grep -rn "FORL\|\"BOSSY\"" --include="*_test.go" internal | head   # ≤ 1 declaration site per literal (C-13)
```
New logic is in an excluded package (`service/`) — no coverage threshold applies; behavior is proven by the tests above.

---

### Step 9 — service: portfolio servability filter on the three watchlist insert paths

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify
- `services/xstockstrat-config/migrations/039_portfolio_servability_timeout.up.sql` — create
- `services/xstockstrat-config/migrations/039_portfolio_servability_timeout.down.sql` — create

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety. Service owner `xstockstrat-config` + config team — new global key seed (naming, `value_type`, environment/global scoping). DBA — config migration number `039`, the up+down pair, and a down limited to global rows (`user_id IS NULL`).

**Codebase Evidence**:
- Call sites: `CreateWatchlist` (`portfolio_service.go:1905`; `bindings := requestBindings(req.GetBindings(), req.GetSymbols(), req.GetDefaultStrategyId())` then `len(bindings) > s.maxSymbolsPerList()` → `InvalidArgument`, then `s.watchlists.Create(…)`); replace-all `UpdateWatchlist` legacy branch (`:2010`, after the mask branch `:2019-2052` returns; `requestBindings(req.GetBindings(), req.GetSymbols(), "")` at `~:2064`, cap check, `s.watchlists.Update(…)`); `AddWatchlistSymbols` (`:2166`; `add := requestBindings(…, existing.GetDefaultStrategyId())`, `resulting := normalizeSymbols(append(existing.Symbols…, bindingSymbols(add)…))`, cap check `:2179-2183`, `s.watchlists.AddSymbols`).
- `requestBindings` (`:1830`, free function — cannot call a service method), `normalizeSymbols` (`:1788`), `normalizeBindings` (`:1807`, preserves `Source`), `applyDefaultStrategy` (`:1847`, skips SIGNAL), `bindingSymbols` (`:1860`).
- Fail-open template: `latestQuotesFor` bounded by `quoteTimeout()` with WARN and `ok=false` (`:402-432`); `quoteCfg intConfig` field `:52-53`, assigned only when the watcher is non-nil `:164-167`; `intConfig` interface `:1781-1784`.
- Client and header propagation: marketdata dial with `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)` at `portfolio_service.go:138`; `UnaryClientInterceptor` injects `x-user-id`/`x-access-scope`/`x-trace-id` (`internal/middleware/propagation.go:39-50`). The new call reuses `s.marketdata`, so it already carries the three headers over the existing mTLS edge.
- Never classify: masked `UpdateWatchlist` branch, `UpdateWatchlistBinding` (`:2080`), `UpdateWatchlistBindings` (`:2112`, rebind-only), `EnsureSignalWatchlist` (`:1939`, takes no symbols), `RemoveWatchlistSymbols`.
- Test seam: `newSvc` in `watchlist_service_test.go:275` leaves `marketdata` nil, so every existing watchlist test runs without a marketdata client — the helper must treat a nil client as "servability unavailable" and let the write through.
- Only INSERT site: `insertBindingsTx` `internal/repository/watchlist_repo.go:494`.
- Cap source: `maxSymbolsPerList()` reads `portfolio.watchlist.max_symbols_per_list` through `s.wlCfg` (`portfolio_service.go:1872-1873`, default 500); Step 3 bounds that key to `[1,1000]`, so the 1000-symbol RPC bound cannot be exceeded by any within-cap request.
- Scope note (B2b, broker symmetry): the asset set is Alpaca-only and the check applies to watchlist symbols regardless of the account's broker. Broker/IBKR holdings, reads, quotes and `GetPnL` never classify (design R1/R6), so an IBKR-only OTC symbol can be held and valued but is refused on a watchlist. No code path in this step touches `BrokerType`.
- 281's `repository.ExpiryIntent` (281 Step 5), `expiryIntentFor` (Step 7) and `AddSymbols(…, intent)` are on `main-dev` before this run starts (merge-order row 92).
- `expiryIntentFor(req, existing, add)` is a small pure helper with no I/O that rejects a provenance add unless there is exactly one SIGNAL binding (281 `implementation-spec.md:362-366`), so calling it twice (Instruction 3, steps 1 and 4) is safe. Filtering first would cut `[BOSSY, AAPL]` with provenance to `[AAPL]` and let it pass validation, breaking 281 `@AC-18`.
- **Drift in 281's landed symbols.** Re-read `expiryIntentFor`, `repository.ExpiryIntent`, the fake intent recorder (281 Step 8) and the `migrationSql.ts` signatures at Phase 1. Any difference from 281's spec must be called out in the §5.4 summary, not aligned silently by a `(re-spec if needed)` pass, and a re-spec must never change the EREA order of Instruction 3.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add the reader-clamp consts `defaultServabilityTimeoutMs = 2000`, `minServabilityTimeoutMs = 500`, `maxServabilityTimeoutMs = 4000` and `(s *PortfolioService) servabilityTimeout() time.Duration`, modelled on `quoteTimeout()` (`:422-432`):
   - `s.quoteCfg == nil` → 2000ms.
   - `ms := s.quoteCfg.GetInt("portfolio.marketdata.servability_timeout_ms", defaultServabilityTimeoutMs)`.
   - `ms <= 0` → 2000ms; `< 500` → 500ms; `> 4000` → 4000ms; else `ms`.

   The key is a double-quoted literal passed straight to `GetInt` at this one call site, as `quoteTimeout` (`:428`) and `maxSymbolsPerList` (`:1873`) do. Do not extract a helper that takes the key as a parameter: 278 would report `dynamic-read`, or 039 would show as `seeded-unread`. The three-line clamp overlap with `quoteTimeout` is accepted (C-18 trade-off).
2. (design.md names this helper `servabilityFor`; the implementation name is `refuseUnservable`.) Add `(s *PortfolioService) refuseUnservable(ctx, bindings []*portfoliov1.WatchlistBinding) (accepted []*portfoliov1.WatchlistBinding, refused []*portfoliov1.RefusedSymbol)`:
   - empty input, or `s.marketdata == nil` → return the input unchanged, no refusals (nil client = unavailable; no WARN in the nil-client test path).
   - Build the symbol list with `bindingSymbols`; call `s.marketdata.GetSymbolServability(qctx, &marketdatav1.GetSymbolServabilityRequest{Symbols: …})` under `context.WithTimeout(ctx, s.servabilityTimeout())` (reuses the propagating client — C-03).
   - On any error, timeout, or `AssetSetLoaded == false`: log `slog.WarnContext(ctx, "symbol servability unavailable; allowing write", "count", …, "error", …)` and return the input unchanged (fail open, FR-5, AC-6, AC-22). Do not add a client-side size constant (see Step Dependencies decision (b)); an oversize request fails open through the RPC `InvalidArgument` and is then rejected by the cap check (the union exceeds `max_symbols_per_list ≤ 1000`), so the bypass is not reachable.
   - Otherwise partition `bindings` by the response (`Servable == false` → refused with its `Reason`), preserving order and each accepted binding's `Source` and `StrategyId`.
3. Wire the three paths **after** `requestBindings` (and so after `applyDefaultStrategy`, so defaults land on accepted symbols only) and **before** the cap check and the repository call:
   - `CreateWatchlist`: `bindings, refused := s.refuseUnservable(ctx, bindings)`; cap check on the accepted count; return `&CreateWatchlistResponse{Watchlist: wl, RefusedSymbols: refused}`. A create where every symbol is refused still creates the (empty) list.
   - Replace-all `UpdateWatchlist` (no-mask branch only): same pattern; a stored unservable symbol resubmitted by a name-only read-modify-write is dropped and reported (AC-19, operator sign-off in `context.md`). Return `RefusedSymbols: refused` on the response.
   - `AddWatchlistSymbols`: after 281, run in this order (`EREA`):
     1. `if _, err := expiryIntentFor(req, existing, add); err != nil { return nil, err }` — 281's validation on the unfiltered request, so 281 `@AC-18` is unchanged and makes no servability call.
     2. `add, refused := s.refuseUnservable(ctx, add)`.
     3. `len(refused) > 0 && len(add) == 0` (every submitted symbol refused) → return `existing` with `RefusedSymbols: refused`, with no `AddSymbols` (so no expiry write) and no ledger event. An originally empty add (`refused` empty) does not return here: it keeps today's behaviour on 281's branch (`AddSymbols` once, then `portfolio.watchlist.updated`).
     4. `intent, err := expiryIntentFor(req, existing, add)` on the accepted bindings, so `UntrackSymbols` never names a refused symbol. A provenance add has one binding, so it is unchanged here or already returned at step 3.
     5. Cap on the post-filter union.
     6. `s.watchlists.AddSymbols(ctx, …, add, intent)`.

     (AC-25, FR-2 for step 5.) No new helper.
4. The filter is uniform on every submitted symbol: no stored-versus-new special-casing (operator steer, `context.md`).
5. `ListAllWatchlistSymbols`, reads, and every masked/rebind RPC stay untouched.
6. Seed 039 in this same commit, with exactly the SQL in `design.md` § Amendment 2026-11-02. The ordering rules, the ban on a `config-wiring.json` edit, the collision check before writing, and the renumber path are all as in Step 5 Instructions 13–14.

**Verification**:
```bash
(cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && grep -n "refuseUnservable\|UnaryClientInterceptor" internal/service/portfolio_service.go \
  && grep -n 'GetInt("portfolio.marketdata.servability_timeout_ms", defaultServabilityTimeoutMs)' internal/service/portfolio_service.go \
  && SEQ=$(awk '/^func \(s \*PortfolioService\) AddWatchlistSymbols\(/{f=1} f{ sub(/\/\/.*/,""); if ($0 ~ /expiryIntentFor\(/) printf "E"; if ($0 ~ /refuseUnservable\(/) printf "R"; if ($0 ~ /s\.watchlists\.AddSymbols\(/) printf "A" } f&&/^}/{exit}' internal/service/portfolio_service.go) \
  && { [ "$SEQ" = "EREA" ] || { echo "FAIL: AddWatchlistSymbols order is '$SEQ', want EREA"; exit 1; }; })
```
The `refuseUnservable` grep expects 3 call sites plus the propagating client dial. Then, **from the repo root**:
- Step 5 block 2, unchanged.
- Step 5 block 3 with `--declared-migration services/xstockstrat-config/migrations/039_portfolio_servability_timeout.up.sql` and the matching `.down.sql` `-f` check.
- Step 5 block 4 with `K=portfolio.marketdata.servability_timeout_ms`, `UP=services/xstockstrat-config/migrations/039_portfolio_servability_timeout.up.sql` and `RD=services/xstockstrat-portfolio/internal/service/portfolio_service.go`, with the same pass condition.

**Merge-time re-check (required).** Run Step 5 Verification block 2 twice (`fails.md:2909-2911`):
- (a) immediately before opening the 282 integration PR;
- (b) immediately before that PR merges into `main-dev`, after the final rebase.

Record each output in `context.md`; any `STOP` or `FAIL` stops the merge. The reason: golang-migrate has no out-of-order guard, so once 038/039 are applied in an environment, a later 035-037 is silently skipped there.

---

### Step 10 — test: portfolio refusals, fail-open, cap, replace-all, contract

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service_test.go` — modify (extend `stubMarketData`)
- `services/xstockstrat-portfolio/internal/service/watchlist_service_test.go` — modify (new tests)
- `services/xstockstrat-portfolio/internal/service/offline_valuation_test.go` — modify (one contract test)

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, concurrent write safety

**Codebase Evidence**:
- `stubMarketData` embeds `marketdatav1.MarketDataServiceClient` and overrides only quote/bars methods (`portfolio_service_test.go:18-61`); unstubbed methods panic, so a `GetSymbolServability` override is required before any servability test can run.
- `newSvc(store, cfg, ledger)` leaves `marketdata` nil (`watchlist_service_test.go:275`); `fakeWatchlistStore` / `fakeConfig` / `wideCaps` / `ctxWithUser` helpers; cap tests `TestSymbolCap_InvalidArgument` (`:450`), `TestAddSymbolsCap_HonoredAfterLowering` (`:481`), `TestWatchlistSymbolsMirror_KeptForCapAndResponses_Feature196` (`:1233`, pins that the cap is enforced from `existing.Symbols`); default-strategy tests `TestAddWatchlistSymbols_SignalSourceSkipsDefault` (`:899`), `TestCreateWatchlist_DefaultAppliedToBareSymbols` (`:829`); masked-update tests `TestUpdateWatchlist_MaskNameOnly_LeavesOthersUntouched` (`:999`).
- Offline-valuation harness: `offlineListSvc` and `TestListPositions_AC27_QuoteHangFallsBackToLastClose` use `stubMarketData{…}` and its `requested [][]string` counter (`offline_valuation_test.go:288-303`, stub field `requested` at `portfolio_service_test.go`).
- C-13 verdict: portfolio's Go fixture home `internal/testdata/` exists (`marks.go:15` `Msft`, `offline_pnl.go:15` `Aapl`). Step 10 uses `testdata.Msft`/`testdata.Aapl` and adds no new inline `"MSFT"`/`"AAPL"`. The OTC tickers stay inline, one file each: `CRTD`/`BOSSY` only in `watchlist_service_test.go` and `FORL` only in `offline_valuation_test.go`. Marketdata's `internal/testdata/assets.go` is a different module and cannot be imported. The stub's `unservable` map is the shared seam.
- 281 Step 8 gives `fakeWatchlistStore` the fields `lastIntent repository.ExpiryIntent` and `addSymbolsCnt int` (`watchlist_service_test.go:37-38` on 281's branch), set in `(*fakeWatchlistStore).AddSymbols` (`:171-173`); tests read them as `store.lastIntent` and `store.addSymbolsCnt`. This step gives `stubMarketData` `unservable` and `servabilityCalls`.
- 281's system-managed-list provenance tests seed the list with `seedWatchlist(store, id, userID string, systemManaged bool, binds []*portfoliov1.WatchlistBinding)` (`watchlist_service_test.go:710` on 281's branch), used by `TestAddWatchlistSymbols_ProvenanceValidation` / `_ProvenanceTracksIntent` / `_NoProvenanceIntent` (`:944-1063`); on 281's branch `newSvc` is at `:293`.
- `expiryIntentFor` (`portfolio_service.go:1856-1885` on 281's branch; checks `:1867-1879`) accepts provenance only on a system-managed list with exactly one SIGNAL binding, `signal_id > 0` and `valid_until` set; any other provenance add is `InvalidArgument`.
- **Drift in 281's landed symbols.** As in Step 9: any difference between 281's spec and the landed `expiryIntentFor`, `repository.ExpiryIntent`, fake intent recorder or `migrationSql.ts` signatures is called out in the §5.4 summary, and a re-spec must never change the EREA order this step's guard test pins.

**TDD**: `red-green required` (fails against the tree before Step 9)

**Covers**: `AC-2, AC-3, AC-6, AC-7, AC-8, AC-17, AC-19, AC-22, AC-25`

**Instructions**:
1. `stubMarketData`: add fields `unservable map[string]commonv1.UnservableReason`, `servabilityLoaded bool` (default true via constructor helper in tests), `servabilityErr error`, `servabilityBlock bool`, `servabilityCalls int`, and a `GetSymbolServability` method that records calls, blocks on `ctx.Done()` when `servabilityBlock`, returns `servabilityErr`, else builds the response from `unservable`.
2. New tests in `watchlist_service_test.go` (each naming its `@AC-N`), building `svc := newSvc(…)` then `svc.marketdata = stub` and `svc.quoteCfg = cfg` for the timeout:
   - AC-2: `AddWatchlistSymbols` BOSSY + AAPL → AAPL stored, BOSSY in `RefusedSymbols` with `UNSERVABLE_REASON_OTC`, stored list is only AAPL.
   - AC-3: `CreateWatchlist` with CRTD + MSFT → list holds MSFT only, CRTD refused.
   - AC-8 (table): `CreateWatchlist` with symbols, replace-all `UpdateWatchlist` with bindings, `AddWatchlistSymbols` with bindings — each refuses CRTD with a reason and stores MSFT; SIGNAL-sourced bindings are filtered the same way and keep `Source`.
   - AC-19: list stores CRTD + MSFT; replace-all update (no mask) resubmitting both → MSFT stays, CRTD dropped and reported.
   - AC-6: stub returns an error (and separately blocks past a `servability_timeout_ms` of 500) → BOSSY is added; capture the `slog` output and assert one WARN "servability unavailable"; also `servabilityLoaded=false` is treated as unavailable.
   - AC-22 (portfolio half): the stub returns `connect.NewError(connect.CodeInvalidArgument, …)` → symbols added, WARN logged.
   - AC-25: cap 500 (use a small cap, e.g. `max_symbols_per_list: 3`) with 2 stored + request `[C, BOSSY]` → C added and BOSSY refused, **no** `InvalidArgument`; and a request whose accepted symbols alone exceed the cap still returns `InvalidArgument`. The existing f196 test `…Feature196` must keep passing (it pins a servable added symbol).
   - AC-7 (portfolio half): a symbol absent from the loaded set (stub reports `UNSERVABLE_REASON_NOT_TRADABLE`) is refused with that reason.
   - Never-classify guards: masked `UpdateWatchlist` (name only), `UpdateWatchlistBinding(s)`, `EnsureSignalWatchlist`, `RemoveWatchlistSymbols` make 0 `servabilityCalls` (preserves `@AC-8/@AC-9 @feature-170`, `@AC-1/@AC-3 @feature-167`).
   - All-refused `AddWatchlistSymbols`: repo `AddSymbols` not called, response carries `existing` and the refusals.
   - Seeded-key reader (config-key wiring (b)): `TestServabilityTimeout_ReadsSeededKey` sets `svc.quoteCfg = &fakeConfig{vals: map[string]int64{"portfolio.marketdata.servability_timeout_ms": 3000}}` and asserts `svc.servabilityTimeout() == 3000*time.Millisecond`. 3000 is non-default and inside `[500,4000]`, so a wrong-key read (default 2000) fails it.
   - Defaults: `default_strategy_id` set, bare MSFT + CRTD → MSFT bound to the default, CRTD refused (EXTEND `@AC-7/@AC-10 @feature-170`).
3. AC-17 (portfolio half), in `offline_valuation_test.go`: an offline position in an unservable symbol (e.g. FORL with a stored 1d close via `stub.bars`) with `stub.unservable` set; `ListPositions` still requests FORL via `GetLatestQuotes` (`stub.requested` contains FORL) and values it from the quote or the stored close; `servabilityCalls == 0` (reads never classify).
4. Existing watchlist tests (nil `marketdata`) must pass unmodified: they prove the nil-client fail-open path.
5. **Filter-before-expiry order guard.** Add `TestAddWatchlistSymbols_RefusedSymbolGetsNoExpiry` to `watchlist_service_test.go`, using `svc.marketdata = stub` with `stub.unservable = {BOSSY: UNSERVABLE_REASON_OTC}`:
   - (a) System list (`seedWatchlist(store, "wl-1", "u-1", true, nil)`), valid provenance (`SignalId > 0`, `ValidUntil` set), one SIGNAL binding BOSSY → no error, `RefusedSymbols == [BOSSY]`, `store.addSymbolsCnt == 0`.
   - (b) Provenance-less SIGNAL add `[BOSSY, AAPL]` → `store.lastIntent.UntrackSymbols == ["AAPL"]`.
   - (c) System list, provenance, two SIGNAL bindings `[BOSSY, AAPL]` → `InvalidArgument`, `servabilityCalls == 0`, `store.addSymbolsCnt == 0`.
   - (d) Originally empty add (no `symbols`, no `bindings`) → no error, empty `RefusedSymbols`, `servabilityCalls == 0`, `store.addSymbolsCnt == 1` (unchanged from 281: the all-refused early return fires only when something was refused).

   RED before Step 9, like every other test in this step: (a) increments `store.addSymbolsCnt` and (b) untracks `[BOSSY, AAPL]` on the pre-Step-9 tree. (c) and (d) are green before Step 9 by design: (c) guards against filter-first, which would make `servabilityCalls` equal 1; (d) guards against an early return on `len(add) == 0` alone.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | awk '/^total:/ {gsub("%","",$3); print "total " $3 "%"; if ($3+0 < 40) {print "FAIL: coverage below the 40% CI threshold"; exit 1}}'
grep -rn "\"CRTD\"" --include="*_test.go" internal | head   # ≤ 1 file declares the literal (C-13 single consumer)
[ "$(grep -c '^func TestAddWatchlistSymbols_RefusedSymbolGetsNoExpiry(' internal/service/watchlist_service_test.go)" -eq 1 ]
[ "$(grep -c '^func TestServabilityTimeout_ReadsSeededKey(' internal/service/watchlist_service_test.go)" -eq 1 ]
```
New logic is in an excluded package (`service/`) — no coverage threshold applies; integration/behavioral verification is the tests above.

---

### Step 11 — service: agent surfaces refusals (Agent consumer surface)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync; admin `x-access-scope` forwarded only by the management tools; no secret values in tool output

**Codebase Evidence**:
- `client.add_watchlist_symbol` (`client.py:315-330`) builds a SIGNAL binding, calls `stub.AddWatchlistSymbols(...)` with `metadata=_metadata(("x-user-id", user_id))` and **discards** the response (returns `None`).
- `client.create_watchlist` (`:~384-397`) and `client.add_watchlist_symbols` (`:525-545`) return `{"watchlist": _watchlist_to_dict(resp.watchlist)}`; `update_watchlist` returns the same shape from the replace-all path (`:~444-512`: GetWatchlist then `UpdateWatchlist(req)` at the end) and from the masked path (`default_strategy_id` set → mask `["default_strategy_id", …]`); `_watchlist_to_dict` = `MessageToDict(wl, preserving_proto_field_name=True)` (`:338-340`).
- `ingest_signal` post-commit block `tools.py:688-696`: `if direction == "watchlist" and not result.get("deduplicated"): try: user_id = _caller_user_id(ctx, "ingest_signal"); wl_id = await client.ensure_signal_watchlist(user_id); await client.add_watchlist_symbol(user_id, wl_id, symbol) except Exception as e: log.warning("Watchlist auto-add failed after ingest_signal (signal already ingested): %s", e)`; returns `result` at `:698`.
- `manage_watchlist` (`tools.py:2040`) and `manage_watchlist_symbols` (`:2124`; add branch `:2155-2158`) pass the client return value straight through.
- Header propagation: all calls go through the existing per-method `metadata=_metadata(("x-user-id", user_id))` (`client.py:317-330, 525-545`); no new outbound call is added — C-03 is satisfied by reuse. Ownership and no admin scope (agent `CLAUDE.md` watchlist-tools section).
- Enum name rendering: generated common stub import used elsewhere as `from gen.common.v1 import common_pb2` (`tests/test_watchlist_client.py` imports it the same way).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `client.py`: add a private helper `_refused_to_list(resp) -> list[dict]` returning `[{"symbol": r.symbol, "reason": common_pb2.UnservableReason.Name(r.reason)} for r in resp.refused_symbols]` (full enum NAME string, e.g. `UNSERVABLE_REASON_OTC`; import `from gen.common.v1 import common_pb2  # noqa: PLC0415` inside the helper like the neighbouring lazy imports).
2. `create_watchlist`, `add_watchlist_symbols`, and the **replace-all branch** of `update_watchlist` return `{"watchlist": …, "refused": _refused_to_list(resp)}` (key always present, list possibly empty). The masked branch (`default_strategy_id` set) never classifies and keeps `{"watchlist": …}` only.
3. `add_watchlist_symbol` returns `_refused_to_list(resp)` (still stamps `WATCHLIST_ENTRY_SOURCE_SIGNAL`; keep the signature `(user_id, watchlist_id, symbol)`); update its docstring and the return annotation to `list[dict[str, str]]`.
4. `tools.py` `ingest_signal`: inside the existing `try`, `refused = await client.add_watchlist_symbol(...)`; when `refused` is non-empty set `result["watchlist_refused"] = refused` (list of `{symbol, reason}`); the ingest result is otherwise unchanged and a refusal never raises (FR-4, f127 `@AC-4`). Because `result` may be shared, copy it (`result = {**result, "watchlist_refused": refused}`) rather than mutate a cached object.
5. `tools.py` docstrings: `manage_watchlist` and `manage_watchlist_symbols` document `Returns {"watchlist": …, "refused": [{"symbol": …, "reason": "UNSERVABLE_REASON_OTC" | "UNSERVABLE_REASON_NOT_TRADABLE"}]}` and that refused symbols were not newly added (a name-only replace-all update resubmitting a now-unservable stored symbol drops it and reports it); `ingest_signal` documents the non-fatal `watchlist_refused`. State the copy the design requires (R7): a mistyped or newly listed ticker is refused until the next asset-set refresh (default 6h, max 24h).

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest tests/test_watchlist_client.py tests/test_watchlist_tools.py tests/test_ingest_signal_watchlist.py tests/test_tool_deadlines.py -q
grep -n "_metadata((\"x-user-id\"" app/client.py | head -5   # new return paths reuse the propagating call sites
```

---

### Step 12 — test: agent refusals, ingest_signal, doc parity

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_watchlist_client.py` — modify
- `services/xstockstrat-agent/tests/test_watchlist_tools.py` — modify
- `services/xstockstrat-agent/tests/test_ingest_signal_watchlist.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Client tests build real proto responses against a mocked stub: `_patch_stub`, `_channel_cm`, `mock_stub.AddWatchlistSymbols = AsyncMock(return_value=portfolio_pb2.AddWatchlistSymbolsResponse(...))` (`tests/test_watchlist_client.py:15-30, 215-250`); the dedup test calls `client.add_watchlist_symbol("user-42", "wl-sig", "AAPL")` (`:247`).
- Tool tests patch `client.*` coroutines and call the raw `.fn` (`tests/test_ingest_signal_watchlist.py:24-60`: `mock_add = AsyncMock(return_value=None)`, `assert result == {"signal_id": 1, "deduplicated": False}`, `mock_add.assert_awaited_once_with("u-2", "wl-sys", "NVDA")`); `tests/test_tool_deadlines.py:238` asserts the `"Watchlist auto-add failed"` WARN.
- Doc parity test `tests/test_watchlist_tools.py:312-322` requires each tool docstring non-empty and `### \`name\`` present in `docs/runbooks/mcp-tools.md`.
- C-13 (Python): response protos are built per test with generated messages; the `CRTD`/`MSFT` values appear in these test files only as one-off literals (single consumer per file, no `conftest.py` change).

**TDD**: `red-green required` (fails before Step 11: no `refused` key, `add_watchlist_symbol` returns `None`)

**Covers**: `AC-5, AC-18, AC-19`

**Instructions**:
1. `test_watchlist_client.py`: build `AddWatchlistSymbolsResponse(watchlist=…, refused_symbols=[RefusedSymbol(symbol="CRTD", reason=common_pb2.UNSERVABLE_REASON_OTC)])` and assert `client.add_watchlist_symbols` returns the watchlist **and** `refused == [{"symbol": "CRTD", "reason": "UNSERVABLE_REASON_OTC"}]`; the same for `create_watchlist` and the replace-all `update_watchlist` (name-only read-modify-write resubmitting CRTD + MSFT; response drops CRTD and reports it — AC-19); the masked `update_watchlist(default_strategy_id=…)` returns no `refused` key; `add_watchlist_symbol` returns the refused list and still sends a SIGNAL binding with `x-user-id` once (extend the existing dedup test).
2. `test_watchlist_tools.py`: `manage_watchlist_symbols add` and `manage_watchlist create` pass through `refused` (AC-18) with the reason NAME string `UNSERVABLE_REASON_OTC` or `UNSERVABLE_REASON_NOT_TRADABLE`; docstring mentions `refused` (doc parity block stays green).
3. `test_ingest_signal_watchlist.py`: new test with `mock_add = AsyncMock(return_value=[{"symbol": "FORL", "reason": "UNSERVABLE_REASON_OTC"}])` → result carries `watchlist_refused` with FORL and the ingest result keys (`signal_id`, `deduplicated`) unchanged (AC-5); the existing tests keep `mock_add` returning `None`/`[]` and assert the result has **no** `watchlist_refused` key (stable shape); a WARN-on-failure test stays as is.
4. Hand-written dict→proto parity: add one descriptor-level assertion that `RefusedSymbol` has exactly the fields `symbol` and `reason` (guards the manual projection, ledger `fails.md` agent-projection entry) and that `AddWatchlistSymbolsResponse` exposes `refused_symbols`.

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest tests/test_watchlist_client.py tests/test_watchlist_tools.py tests/test_ingest_signal_watchlist.py tests/test_tool_deadlines.py -q
pytest --cov=app --cov-report=term --cov-fail-under=40 -q   # full suite: the CI gate (coverage_threshold 40, cov_source app)
grep -n "conftest\|def .*fixture" tests/test_watchlist_client.py | head -3   # C-13: no second inline copy of a domain fixture introduced
```

---

### Step 13 — service: UI refusal notices and masked rename (UI consumer surface)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/opportunityShared.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/RefusedSymbolsNotice.tsx` — create
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify
- `services/xstockstrat-ui/src/app/insights/screener/page.tsx` — modify

**Reviewers**: Service owner `xstockstrat-ui` — Connect-RPC call safety, environment scope correctness, no direct DB access, UI correctness

**Codebase Evidence**:
- Exhaustive render maps: `src/lib/opportunityShared.tsx:1-2` ("Exhaustive Record<Enum,…> maps — adding a proto enum value without a map entry breaks `tsc` here"); imports of numeric protobuf-es enums from `@xstockstrat/proto/<svc>/v1/<svc>_pb` at `:8-15`; `EnumRender { label, role, icon? }` at `:20-28`; examples `FUNDAMENTALS_GAP: Record<FundamentalsGap, EnumRender>` `:40-45`. Ledger `insights.md:~192` / `fails.md:81-83`: a new proto enum value hard-couples to every exhaustive TS map in the same PR.
- Add controls (no `/trader` add control exists): `WatchlistDetail.tsx:101-115` (`handleAddSymbol` → `addSymbols.mutate({watchlistId, symbols, bindings}, { onSuccess: () => setSymbolInput('') })`, no error UI); `screener/page.tsx:149-158` (`handleSaveAsWatchlist` → `createWl.mutate({name, symbols: saveSymbols}, { onSuccess: () => setSaveName('') })`; `handleAddTopN` → `addSymbols.mutate({watchlistId: targetListId, symbols: topNSymbols})`); controls rendered `:512-545`, existing `createWl.error` paragraph `:547-549`; `/insights/watchlists/page.tsx:57-71` create dialog is name-only (no symbols, nothing to refuse).
- Rename: `commitRename` (`WatchlistDetail.tsx:126-134`) currently sends `{watchlistId, name, description, bindings}` (replace-all); the masked path already exists as `setDefaultStrategy` → `updateWatchlist.mutate({ watchlistId, updateMask: ['default_strategy_id'], … })` (`:146`); `useUpdateWatchlist` maps `updateMask` to `{ paths: input.updateMask }` (`src/hooks/useWatchlists.ts:76-84`).
- Hooks return the typed RPC result so `refusedSymbols` is available on `onSuccess`: `useAddWatchlistSymbols`, `useCreateWatchlist` (`useWatchlists.ts:37-48, ~98-110`) over `insightsPortfolioClient` (`src/lib/browserClients/insightsPortfolioClient.ts:8`); BFF passthrough `forward(...)` for `createWatchlist`/`updateWatchlist`/`addWatchlistSymbols` (`src/lib/insightsBff.ts:134-144`) already forwards the response whole and propagates headers (no BFF change).
- Primitives: `CardNotice` (`src/components/shared/CardNotice.tsx`, `variant: 'muted' | 'error'`, `role="alert"` on error) — C-17 canonical notice; no toast library.

**TDD**: `red-green required` (paired Step 14; frontend steps are not subject to C-08 test pairing but this step has a paired test step)

**Covers**: —

**Instructions**:
1. `opportunityShared.tsx`: import `UnservableReason` from `@xstockstrat/proto/common/v1/common_pb` and add `export const UNSERVABLE_REASON: Record<UnservableReason, string>` (exhaustive; plain strings, not `EnumRender`): `UNSPECIFIED: 'not available'`, `OTC: 'over-the-counter symbol (no market data on the configured feed)'`, `NOT_TRADABLE: 'not an active, tradable US equity'`. Keep it next to the other maps; do not render the proto enum NAME string in the UI.
2. `RefusedSymbolsNotice.tsx` (new, `'use client'`): props `{ refused: { symbol: string; reason: UnservableReason }[] }`; renders `null` when empty, otherwise `<div data-testid="watchlist-refused-notice"><CardNotice variant="muted">…</CardNotice></div>` listing each symbol with its `UNSERVABLE_REASON` text, plus one sentence that a new or mistyped ticker is refused until the asset list refreshes (up to 24h; design R7). No hardcoded colors; uses design tokens through `CardNotice` only (C-17).
3. `WatchlistDetail.tsx`: add `const [refused, setRefused] = useState<RefusedSymbol[]>([])` (`RefusedSymbol` type from `@xstockstrat/proto/portfolio/v1/portfolio_pb`); in `handleAddSymbol` clear it before mutate and set it in `onSuccess: (res) => { setSymbolInput(''); setRefused(res.refusedSymbols) }`; render `<RefusedSymbolsNotice refused={refused} />` under the add control. State resets on remount per watchlist (`key={watchlistId}`).
4. `commitRename` → send the masked partial update: `updateWatchlist.mutate({ watchlistId, updateMask: ['name'], name: trimmed })` (drop `description`/`bindings`); stored symbols are never dropped or classified by a rename (AC-21).
5. `screener/page.tsx`: hold `refused` state for the two add actions; `handleSaveAsWatchlist` sets it from `createWl.mutate(…, { onSuccess: (res) => { setSaveName(''); setRefused(res.refusedSymbols) } })` and `handleAddTopN` from `addSymbols.mutate(…, { onSuccess: (res) => setRefused(res.refusedSymbols) })`; render one `<RefusedSymbolsNotice refused={refused} />` next to the existing `createWl.error` paragraph (`:547`).
6. One shared notice for both controls (C-10): do not copy the markup.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:check && pnpm run lint:dup
```

---

### Step 14 — test: UI vitest map test, e2e fixtures, refusal and rename specs

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/opportunityShared.test.ts` — modify
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/screener.spec.ts` — modify

**Reviewers**: Service owner `xstockstrat-ui` — Connect-RPC call safety, UI correctness

**Codebase Evidence**:
- Vitest data-map tests: `src/lib/opportunityShared.test.ts` (node-env `src/**/*.test.ts`; coverage scoped to `src/lib/**`).
- Stateful watchlist mock: `mockWatchlists(page, seed, readinessOverrides)` in `e2e/helpers/watchlistMock.ts:~38-140`, routes `CreateWatchlist` / `UpdateWatchlist` (mask path parsed by `maskPaths`: Connect-JSON encodes `FieldMask` as a comma-joined camelCase string) / `AddWatchlistSymbols` as `page.route('**/xstockstrat.portfolio.v1.PortfolioService/…')` returning `json(route, { watchlist: … })`; catalog row "Watchlists (stateful mock)" in `e2e/fixtures/INVENTORY.md:~43`.
- Existing specs: `e2e/insights/watchlists.spec.ts` (`createList`, `addSymbols`, `bindStrategy` helpers; rename test `:137-182` already proves the bound symbol survives a rename), `e2e/insights/screener.spec.ts` (Save/Add-top-N tests `:~245-300`, `data-testid` `save-as-watchlist` / `add-top-n`).
- Ledger traps: mock enums must use protojson NAME strings (`fails.md:676`); scoped Playwright run with `--no-deps` plus manual pre-warm (`fails.md` e2e entry, `insights.md`).
- C-12: auth via `addAuthCookie` (`e2e/helpers/auth.ts`); the unservable fixture lives beside the watchlist mock (the existing home for this domain), with an INVENTORY row.

**TDD**: `red-green required`

**Covers**: `AC-20, AC-21`

**Instructions**:
1. `opportunityShared.test.ts`: assert `UNSERVABLE_REASON` has one non-empty entry per `UnservableReason` value (keys equal `Object.values(UnservableReason)` numeric members) and that `OTC` and `NOT_TRADABLE` texts differ.
2. `watchlistMock.ts`: add an exported `MOCK_UNSERVABLE: Record<string, 'UNSERVABLE_REASON_OTC' | 'UNSERVABLE_REASON_NOT_TRADABLE'> = { CRTD: 'UNSERVABLE_REASON_OTC' }` (protojson NAME strings) and a 4th optional parameter `unservable = {}` to `mockWatchlists`; in the `CreateWatchlist`, replace-all `UpdateWatchlist` (no mask) and `AddWatchlistSymbols` handlers, drop bindings whose symbol is in `unservable` and return `refusedSymbols: [{ symbol, reason }]` alongside `watchlist`; the masked `UpdateWatchlist` path never classifies. Update the header comment and the `INVENTORY.md` "Watchlists (stateful mock)" row (new symbol, parameter, consumers).
3. `watchlists.spec.ts`: new test (AC-20): seed an empty list, `mockWatchlists(page, [list], {}, MOCK_UNSERVABLE)`, add `CRTD, MSFT` → MSFT row present, CRTD absent, `getByTestId('watchlist-refused-notice')` contains `CRTD` and the OTC reason text. Extend the rename test or add one (AC-21): seed a list storing CRTD + MSFT with CRTD unservable, capture the `UpdateWatchlist` request via `page.waitForRequest`, rename, assert the posted body carries `updateMask` `name` (and no `bindings`), both symbols remain, and no refusal notice appears.
3b. Rewrite the two existing rename assertions that the masked rename breaks:
   - **(i)** `e2e/insights/watchlists.spec.ts:146-147`. The current comment is `// Commit a rename — the header updates and the bound symbol's binding survives (fails-080` / `// invariant: rename sends the full current bindings array, never a partial one).` Replace it with `// A rename is a masked name-only update: stored bindings are never resent or dropped.` Then wrap the Enter press at `:151` with `const renameReqP = page.waitForRequest((r) => r.url().endsWith('/UpdateWatchlist'));` … `const renameBody = JSON.parse((await renameReqP).postData() ?? '{}');` and assert `expect(renameBody.updateMask).toBe('name');` and `expect(renameBody.bindings).toBeUndefined();`. The `:155` readiness-row assertion stays.
   - **(ii)** Change three places:
     - The `:606` title, currently `'set/read the watchlist default strategy via a masked update; edits stay unmasked (feature 170, AC-6)'`, becomes `'set/read the watchlist default strategy via a masked update; a rename is masked to name only (feature 170, AC-6)'`.
     - The `:626` comment, currently `// Mask discipline (design Open Risk): a legacy rename must NOT carry update_mask.`, becomes `// A rename is masked to name only: it carries neither bindings nor defaultStrategyId.`
     - The `:633` assertion, currently `expect(renameBody.updateMask ?? '').toBe('');`, becomes three assertions: `expect(renameBody.updateMask).toBe('name');`, `expect(renameBody.bindings).toBeUndefined();` and `expect(renameBody.defaultStrategyId).toBeUndefined();`. A FieldMask serializes to a camelCase string (`:619-620`).
   - **C-16:** the durable `@AC-6 @feature-170` scenario (`services/xstockstrat-ui/acceptance/watchlist-bulk-default-strategy.feature:19-24`) says nothing about masking, so PRESERVE holds and this is a test-only rewrite.
4. `screener.spec.ts`: Save-as (`createWatchlist`) and Add top N (`addWatchlistSymbols`) tests with `MOCK_UNSERVABLE` → MSFT added, the shared notice lists CRTD with its reason (AC-20).
5. Run the specs scoped (`--project=chromium --no-deps`) after manually pre-warming the `/insights/watchlists` and `/insights/screener` routes (ledger e2e pre-warm note).

**Verification**:
```bash
cd services/xstockstrat-ui   # once, from the repo root; every line below runs in services/xstockstrat-ui
pnpm exec tsc --noEmit && pnpm run lint && pnpm run test:coverage   # vitest.config thresholds lines: 40
pnpm exec playwright test e2e/insights/watchlists.spec.ts e2e/insights/screener.spec.ts --project=chromium --no-deps
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth\|watchlistMock" e2e/insights/watchlists.spec.ts e2e/insights/screener.spec.ts | head
grep -n "MOCK_UNSERVABLE" e2e/fixtures/INVENTORY.md
```

---

### Step 15 — docs: agent runbook, agent CLAUDE.md, registered keys

**Status**: `pending`
**Service**: `docs/runbooks/`, `docs/patterns/`, `xstockstrat-agent`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify (`ingest_signal` `:224-255`, `manage_watchlist` / `manage_watchlist_symbols` `:1263-1335`)
- `services/xstockstrat-agent/CLAUDE.md` — modify (tool table rows `:~82-83`, watchlist section `:~134`)
- `docs/patterns/config-governance.md` — modify (append a Per-Feature Registered Keys entry)

**Reviewers**: none

**Codebase Evidence**:
- Doc parity is test-enforced for the watchlist tools: `tests/test_watchlist_tools.py:312-322` requires the runbook headings; `docs/runbooks/mcp-tools.md` anchors confirmed at `### \`ingest_signal\`` (~L224), `### \`manage_watchlist\`` and `### \`manage_watchlist_symbols\`` (~L1263-1335).
- The Per-Feature Registered Keys log is append-only, newest first (`docs/patterns/config-governance.md:109-111`), and feature 229's entry (`:165-181`) is the table format to follow.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `mcp-tools.md`: `ingest_signal` — add `watchlist_refused` (present only when non-empty) to **Return**, an **Errors** row (unservable symbol: skipped, ingest still succeeds), and the R7 note; `manage_watchlist` / `manage_watchlist_symbols` — **Returns** `{"watchlist": …, "refused": [{symbol, reason}]}`, reason names, "refused = not newly added", a name-only replace-all update drops and reports a now-unservable stored symbol. Mirror every statement in the tool docstrings (Step 11) and the agent `CLAUDE.md` rows.
2. Agent `CLAUDE.md`: update the `manage_watchlist` / `manage_watchlist_symbols` table rows and the watchlist-tools paragraph with the same statements; keep the tool-count statements unchanged (no tool is added).
3. `docs/patterns/config-governance.md`: append a "feature 282 — filter-otc-symbols" entry at the top of the Per-Feature Registered Keys log with both new keys (defaults, bounds, seeded by config migrations `038_marketdata_asset_refresh_interval` / `039_portfolio_servability_timeout` — global staging + production rows, insert-if-absent, down deletes global rows only, no `config-wiring.json` baseline entry — owner + config-team approval) and the new write-edge bound `[1,1000]` on the existing `portfolio.watchlist.max_symbols_per_list` (coupling: marketdata's 1000-symbol RPC bound).

**Verification**:
```bash
grep -n "watchlist_refused\|refused" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md | head
grep -n "marketdata.assets.refresh_interval_hours\|portfolio.marketdata.servability_timeout_ms\|max_symbols_per_list" docs/patterns/config-governance.md
cd services/xstockstrat-agent && pytest tests/test_watchlist_tools.py -q -k doc_parity
```

---

### Step 16 — test: config seed parse tests for 038/039, shared global-int seed helper (AC-27)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/globalIntSeedCases.ts` — create (shared non-`.test` helper; `migrationSql.ts` precedent)
- `services/xstockstrat-config/src/__tests__/servabilitySeedMigrations.test.ts` — create
- `services/xstockstrat-config/src/__tests__/signalPruneIntervalSeedMigration.test.ts` — modify (created by feature 281; converted to the helper, assertions preserved)

**Reviewers**: Service owner `xstockstrat-config` — key naming, scoping, WatchConfig stream stability. DBA — the AC-27 assertions on the 038/039 down scope and the preserved 037 assertions (`@AC-19 @feature-281`).

**Codebase Evidence**:
- 281 is on `main-dev` before this run starts (merge-order row 92).
- 281 Step 14 defines `migrationSql.ts` (`export const MIGRATIONS_DIR`, `export function findOne(suffix: string, ext: 'up' | 'down'): string`, `export function splitStatements(sql: string): string[]`; imports `node:assert/strict`, `node:fs`, `node:path`). Its consumers are 281's seed test (imports `findOne, splitStatements` only) and `zeroTrapDescriptionMigration.test.ts` (imports all three; 4 `it()` cases).
- 281's seed test `signalPruneIntervalSeedMigration.test.ts` (verified on `origin/feature/signal-watchlist-expiry-pruning` `0657f082`): module-private `SUFFIX = '_portfolio_signal_prune_interval'`, `KEY` (inline), `LIT`, `ROW` (`Array(8).fill(LIT)` plus `NULL`), `INSERT_RE`, an `interface SeedRow` and a `parseUp()` that captures the two rows at group offsets `[1, 9]`. It has one `describe('signal prune interval seed migration (@AC-19)', …)` with five plain `it()` cases, titles not key-prefixed. Case 1 asserts `parseUp().length === 2`, and case 4 asserts `Number.isInteger(n) && n >= 60 && n <= 86400`.
- 281's seed pair is `037_portfolio_signal_prune_interval.up.sql` and `.down.sql`. Up is `--` comments plus one INSERT: column list `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)`, rows staging then production with 8 literals plus `NULL`, and `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`. Down is one comment plus `DELETE … WHERE namespace = 'portfolio' AND key = '…' AND user_id IS NULL`. `INSERT_RE` is exact after `splitStatements`, so 038/039 must keep that column order and row shape.
- Re-read all three at Phase 1. If the case count is not 5, or the regex names or `findOne`'s signature differ from the above, raise a blocker; do not adapt silently.
- Test globs pick up only `dist/__tests__/*.test.js` (`package.json:12-13`), so the helper never runs as a suite. jscpd ignores `**/__tests__/**` (`.jscpd.json:29`), so only this step prevents a second copy of the case logic.
- 038 lands in Step 5 and 039 in Step 9, so RED is recorded by moving both pairs aside (281 Step 14 precedent).
- **Drift in 281's landed symbols.** As in Steps 9 and 10: any difference between 281's spec and the landed `migrationSql.ts` signatures (or `expiryIntentFor`, `repository.ExpiryIntent`, the fake intent recorder) is called out in the §5.4 summary, and a re-spec must never change the EREA order of Steps 9-10.

**TDD**: red-green required.
- Seed cases: RED is recorded once, as below, with 10 failures on `findOne`'s "expected exactly one". The 037 conversion is a refactor: `# pass 5` before and after.

**Covers**: `AC-27`

**Instructions**:
0. If `src/__tests__/migrationSql.ts` is absent, raise a §5.7 blocker; never copy from 281's branch.
1. Before editing, run `pnpm run build && node --test --test-reporter=tap dist/__tests__/signalPruneIntervalSeedMigration.test.js` in `services/xstockstrat-config` and record `# pass 5` in `context.md`.
2. **`globalIntSeedCases.ts`.** Move 281's `LIT`, `ROW` and `INSERT_RE` construction, its `SeedRow` interface, its `parseUp()` (taking `suffix` as a parameter) and its five case bodies here verbatim, changing only the parameters.
   - Export only `interface GlobalIntSeed { suffix: string; namespace: string; key: string; consumingService: string; value: number; min: number; max: number }` and `globalIntSeedCases(seed: GlobalIntSeed): void`. `LIT`, `ROW`, `INSERT_RE`, `SeedRow` and `parseUp` stay module-private.
   - `globalIntSeedCases` registers exactly five plain `it()` cases with titles prefixed by `seed.key`. Each case reads its files inside the `it`, through `findOne(seed.suffix, …)`.
   - The five cases:
     1. up is one statement full-matching `INSERT_RE`, yielding two rows;
     2. both rows have `namespace`, `key`, `value_type 'int'` and `consuming_service`;
     3. the environments are exactly `['production','staging']`;
     4. `value_data === default_value === String(value)`, an integer in `[min,max]`;
     5. `splitStatements(down)` deep-equals `["DELETE FROM config.config_values WHERE namespace = '<ns>' AND key = '<key>' AND user_id IS NULL"]`.
   - The helper holds no domain data, imports only `it` from `node:test`, `assert` from `node:assert/strict` and `findOne, splitStatements` from `./migrationSql`, and is never imported by `src/` runtime code.
   - Prefixing titles with `seed.key` renames 281's five cases. Their assertions are unchanged.
3. Convert 281's file to `describe('signal prune interval seed migration (@AC-19)', () => globalIntSeedCases({ suffix: SUFFIX, namespace: 'portfolio', key: KEY, consumingService: 'xstockstrat-portfolio', value: 300, min: 60, max: 86400 }))`. Delete its local `LIT`, `ROW`, `INSERT_RE`, `SeedRow`, `parseUp` and case bodies. `SUFFIX` and `KEY` stay inline. Its imports shrink to `describe` from `node:test` and `globalIntSeedCases` from `./globalIntSeedCases`; drop `it`, `assert`, `findOne` and `splitStatements`, or eslint reports them as unused.
4. **`servabilitySeedMigrations.test.ts`.** Two calls, with the literals inline (single consumer, C-13):
   - `{ suffix: '_marketdata_asset_refresh_interval', namespace: 'marketdata', key: 'marketdata.assets.refresh_interval_hours', consumingService: 'xstockstrat-marketdata', value: 6, min: 1, max: 24 }`
   - `{ suffix: '_portfolio_servability_timeout', namespace: 'portfolio', key: 'portfolio.marketdata.servability_timeout_ms', consumingService: 'xstockstrat-portfolio', value: 2000, min: 500, max: 4000 }`

**Verification** (run from the repo root):
```bash
(
cd services/xstockstrat-config || exit 1
[ -f src/__tests__/migrationSql.ts ] || { echo "STOP: migrationSql.ts absent - Instruction 0"; exit 1; }
[ "$(grep -cE "^[[:space:]]*it\(" src/__tests__/globalIntSeedCases.ts)" -eq 5 ] || { echo "FAIL: helper must register exactly 5 it()"; exit 1; }
! grep -nE '^export (const|let) (LIT|ROW|INSERT_RE)' src/__tests__/globalIntSeedCases.ts || { echo "FAIL: LIT/ROW/INSERT_RE must stay private"; exit 1; }
[ "$(grep -c 'globalIntSeedCases(' src/__tests__/servabilitySeedMigrations.test.ts)" -eq 2 ] || exit 1
[ "$(grep -c 'globalIntSeedCases(' src/__tests__/signalPruneIntervalSeedMigration.test.ts)" -eq 1 ] || exit 1
! grep -nE 'INSERT_RE|const LIT|const ROW' src/__tests__/signalPruneIntervalSeedMigration.test.ts src/__tests__/servabilitySeedMigrations.test.ts || exit 1
pnpm run lint || exit 1
OUT=$(pnpm run build && node --test --test-reporter=tap dist/__tests__/zeroTrapDescriptionMigration.test.js dist/__tests__/signalPruneIntervalSeedMigration.test.js dist/__tests__/servabilitySeedMigrations.test.js 2>&1); rc=$?
echo "$OUT" | tail -n 12
[ "$rc" -eq 0 ] && echo "$OUT" | grep -q '^# fail 0$' && echo "$OUT" | awk '/^# pass [0-9]+$/ { n = $3 } END { exit !(n >= 19) }' || { echo "FAIL: combined run"; exit 1; }
node --test --test-reporter=tap dist/__tests__/servabilitySeedMigrations.test.js 2>&1 | grep -q '^# pass 10$' || { echo "FAIL: want 10"; exit 1; }
node --test --test-reporter=tap dist/__tests__/signalPruneIntervalSeedMigration.test.js 2>&1 | grep -q '^# pass 5$' || { echo "FAIL: want 5"; exit 1; }
pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
)
```
**Pass condition:**
- The subshell exits 0.
- `# fail 0`; at least 19 passes across the three config files (zeroTrap 4 + 037's 5 + 038/039's 10); exactly 10 in the new file and exactly 5 in 281's file.
- Config coverage at least 40%.

Recorded RED for the seed cases, run once and never part of the gate:
```bash
(
cd services/xstockstrat-config || exit 1
R=$(mktemp -d "${TMPDIR:-/tmp}/red282.XXXXXX") || exit 1
[ -n "$R" ] && [ -d "$R" ] || { echo "FAIL: no temp dir"; exit 1; }
mv migrations/038_marketdata_asset_refresh_interval.*.sql migrations/039_portfolio_servability_timeout.*.sql "$R/" || exit 1
built=1; red=0; RED_OUT=''
pnpm run build && { built=0; RED_OUT=$(node --test --test-reporter=tap dist/__tests__/servabilitySeedMigrations.test.js 2>&1); red=$?; echo "$RED_OUT"; }
[ -n "$R" ] && mv "$R"/03[89]_*.sql migrations/ && rmdir "$R" || { echo "FAIL: restore the pairs from $R"; exit 1; }
[ "$built" -eq 0 ] || { echo "FAIL: build"; exit 1; }
[ "$red" -ne 0 ] && echo "$RED_OUT" | grep -q 'expected exactly one' && echo "$RED_OUT" | grep -q '^# fail 10$' && [ -z "$(git status --porcelain migrations/)" ]
)
```
The restore always runs, including after a failed build, and only when `$R` is non-empty.

---

### Step 17 — docs: marketdata and portfolio CLAUDE.md, constitutions, teardown

**Status**: `pending`
**Service**: `xstockstrat-marketdata`, `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (config table near `:85`, asset-set section near `:168-175`)
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify (new `MARKETDATA-*` invariant)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (config table near `:110`, watchlist section)
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify (new `PORTFOLIO-*` invariant)

**Reviewers**: none

**Codebase Evidence**:
- Config tables: marketdata `CLAUDE.md:85` lists `marketdata.classification.refresh_interval_hours`; portfolio `CLAUDE.md:110` lists `portfolio.marketdata.quote_timeout_ms` (and the watchlist keys incl. `portfolio.watchlist.max_symbols_per_list`).
- Constitutions: marketdata `MARKETDATA-*` rows (`docs/context-constitution.md:16-33`, `MARKETDATA-5` pause rule); portfolio `PORTFOLIO-*` rows (`:20-33`).
- Root `CLAUDE.md` § Teardown: a session that changed context files must run `/context-forge:context-constitution refresh` scoped to the touched files, or reconcile by hand and record both facts in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Marketdata `CLAUDE.md`: config row `marketdata.assets.refresh_interval_hours` (int, default `6`, SetConfig bounds `[1,24]`, clamped on read, `<= 0` pauses (reader-only: `SetConfig` rejects 0), seeded by config migration `038_marketdata_asset_refresh_interval`); an "Asset-set servability" section stating the predicate (absent from the active+tradable `us_equity` set, or exchange `OTC`), the fixed invariants (shrink guard 50%, backoff 1m→30m, RPC bound 1000, immediate first load, first-load-only warm prune, accepted residuals R2/R3), and the gate's scope (warm-add sites only).
2. Marketdata `docs/context-constitution.md`: new `MARKETDATA-15` — "the unservable gate applies at warm-add sites only (`markWarmIfServable` in `GetBars`/`BatchGetBars`/`BatchGetLatestPrice`); warm-set readers and the quote/price paths are never filtered", with the held-position coupling (R11: portfolio always quotes offline positions via `GetLatestQuotes`, `trading.go:1074` publishes `current_price: 0`) and the guard tests.
3. Portfolio `CLAUDE.md`: config row `portfolio.marketdata.servability_timeout_ms` (int, `2000`, bounds `[500,4000]`, clamped, seeded by `039_portfolio_servability_timeout`) and the new bound `[1,1000]` on `portfolio.watchlist.max_symbols_per_list`; portfolio `docs/context-constitution.md`: new `PORTFOLIO-18` (PORTFOLIO-15/16 exist and feature 281 claims PORTFOLIO-17; if that moves, take the next free number and log it in the Deviation Log) — "servability is asked of marketdata (never re-derived from `Asset.exchange`), uniform on every submitted symbol on Create/replace-all Update/AddWatchlistSymbols, fail-open with WARN, cap on the post-filter union; masked/rebind/Ensure RPCs and reads never classify; the servability filter runs after 281's provenance validation and before its expiry write".
4. Teardown (last action before pushing): run `/context-forge:context-constitution refresh` scoped to every context file this feature touched (the four files above plus Step 15's `services/xstockstrat-agent/CLAUDE.md`, `docs/runbooks/mcp-tools.md`, `docs/patterns/config-governance.md`); fix the grounded drift it reports. If the plugin is unavailable, re-read each touched file against the final code, reconcile the drift, and record **both** that the plugin was unavailable and the manual reconciliation in the PR body and in `context.md`.

**Verification**:
```bash
grep -n "marketdata.assets.refresh_interval_hours" services/xstockstrat-marketdata/CLAUDE.md
grep -n "portfolio.marketdata.servability_timeout_ms\|max_symbols_per_list" services/xstockstrat-portfolio/CLAUDE.md
grep -n "MARKETDATA-15" services/xstockstrat-marketdata/docs/context-constitution.md
grep -n "PORTFOLIO-18" services/xstockstrat-portfolio/docs/context-constitution.md
git diff --name-only origin/main-dev -- '*CLAUDE.md' '*context-constitution.md' docs/runbooks/mcp-tools.md docs/patterns/config-governance.md   # the teardown scope; its result and the refresh outcome go into context.md and the PR body
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
