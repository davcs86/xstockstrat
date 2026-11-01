# Implementation Spec: filter-otc-symbols

**Status**: `pending`
**Created**: 2026-11-01
**Feature**: `docs/roadmap/features/282-filter-otc-symbols/feature.md`
**Total Steps**: 15
**Feature Branch**: `feature/filter-otc-symbols`

---

## Execution Summary

Proto first (Steps 1-2: `common.v1.UnservableReason`, `marketdata.v1.GetSymbolServability`, `portfolio.v1.RefusedSymbol` + `refused_symbols`), then the two new config keys at the config write edge (Steps 3-4). Marketdata is built next in two slices: the asset-set predicate, refresher and RPC (Steps 5-6), then the warm-add gate at `GetBars`/`BatchGetBars`/`BatchGetLatestPrice` (Steps 7-8). Portfolio consumes the RPC and refuses per symbol on the three insert paths (Steps 9-10), then the consumer surfaces land separately per C-14: Agent (Steps 11-12) and UI (Steps 13-14). Step 15 is docs, constitution invariants and the registered-keys log.

Consumer surfaces (C-14): UI `/insights` (Step 13: `WatchlistDetail`, screener save-as and Add top N, rename via masked update) and Agent (Step 11: `manage_watchlist_symbols`, `manage_watchlist`, `ingest_signal`). No new page or route, so C-10(a) nav registration is not triggered. No new env var or port: the two keys are config keys, so `docker-compose.yml`, `.do/app.dev.yaml` and `.do/app.yaml` are untouched. No migration (in-memory asset set).

C-16 business-rule changes (signed off in `context.md`, rounds 1 and 3) are promoted into the durable suites at launch by the `/sdd-execute` integration PR, not by a step here: CHANGE `@AC-5 @feature-148` and `@AC-1 @feature-127`; EXTEND `@AC-53/@AC-54 @feature-240`, `@AC-4/@AC-7 @feature-148`, `@AC-7/@AC-10 @feature-170`, `@AC-5 @feature-127`.

### Scenario Coverage (C-15)

| Scenario | Step(s) |
|---|---|
| AC-1 | 6 |
| AC-2 | 10 |
| AC-3 | 10 |
| AC-4 | 8 |
| AC-5 | 12 |
| AC-6 | 10 |
| AC-7 | 8, 10 |
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
| AC-22 | 6, 10 |
| AC-23 | 6, 8 |
| AC-24 | 4, 6 |
| AC-25 | 10 |
| AC-26 | 8 |

## Step Dependencies

- Step 2 requires Step 1: regenerated stubs come from the edited `.proto` files.
- Steps 5, 9, 11 and 13 require Step 2: they compile against `UnservableReason`, `GetSymbolServability`, `RefusedSymbol`.
- Step 4 [test] covers Step 3 [service]; Step 6 [test] covers Step 5; Step 8 [test] covers Step 7; Step 10 [test] covers Step 9; Step 12 [test] covers Step 11; Step 14 [test] covers Step 13. Each test step is authored to fail against the pre-implementation tree (P-06).
- Step 7 requires Step 5: `markWarmIfServable` and the snapshot live in `asset_servability.go`.
- Step 9 requires Step 5 only at runtime (portfolio calls the RPC); at compile time it needs Step 2.
- Step 8 and Step 6 both consume the marketdata asset fixtures: the fixture home `internal/testdata/assets.go` is created in Step 6 (C-13: Step 8 is the known second consumer, so the literal is centralized up front rather than copied).
- Step 15 requires Steps 3, 5, 9, 11, 13 (documents their final behavior); run the CLAUDE.md teardown (`/context-forge:context-constitution refresh`, scoped to the touched context files) as the last step before pushing.
- Merge order: soft row after `block-fundamentals-strategy-on-etf` (215) in `docs/roadmap/features/merge-order.md:91`. 282 re-anchors its `marketdata.proto` and `marketdata_service.go` line references after 215 lands (design R10).
- Open decisions carried to `/sdd-review impl-spec` (P-03, not guessed silently): (a) agent `refused` key is always present on create/add/replace-update responses, but `watchlist_refused` on `ingest_signal` is present only when non-empty (keeps the documented `{signal_id, deduplicated}` shape stable); (b) design.md says "a size check before the RPC" and also rejects chunking because it would duplicate marketdata's 1000 constant, so Step 9 adds no client-side constant and relies on the RPC `InvalidArgument` failing open with a WARN; (c) the config registry bound `[1,24]` for `marketdata.assets.refresh_interval_hours` rejects `0` at `SetConfig`, so "`<= 0` pauses" is a reader-only defence (AC-24 is tested at the reader).

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
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/filter-otc-symbols"
```
(`buf breaking` must report no findings; if the feature branch does not exist yet, compare against `.git#branch=main-dev`.)

---

### Step 2 — proto-gen: regenerate Go, Python and TypeScript stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/common/v1/common.pb.go` — modify (generated)
- `packages/proto/gen/go/marketdata/v1/marketdata.pb.go`, `marketdata_grpc.pb.go`, `marketdatav1connect/*` — modify (generated)
- `packages/proto/gen/go/portfolio/v1/portfolio.pb.go`, `portfolio_grpc.pb.go`, `portfoliov1connect/*` — modify (generated)
- `packages/proto/gen/python/common/v1/common_pb2.py`, `marketdata/v1/marketdata_pb2.py`, `marketdata_pb2_grpc.py`, `portfolio/v1/portfolio_pb2.py` — modify (generated)
- `packages/proto/gen/ts/common/v1/common.ts`, `common_pb.ts`, `marketdata/v1/{marketdata.ts,marketdata_connect.ts,marketdata_pb.ts}`, `portfolio/v1/*` — modify (generated; plus `gen/ts/dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility, `buf lint` / `buf breaking`; Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency; Service owner `xstockstrat-portfolio` — P&L calculation accuracy, concurrent write safety

**Codebase Evidence**:
- Confirmed via: `ls packages/proto/gen/go/marketdata/v1 packages/proto/gen/python/marketdata/v1 packages/proto/gen/ts/marketdata/v1` → the three language trees exist and are checked in (root `CLAUDE.md` § Generating Proto Stubs; CI `proto-freshness` enforces a clean diff).
- Generated stubs are never hand-edited (root `CLAUDE.md` § Key File Paths Reference).

**TDD**: `N/A (generated code)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root (toolchain provisioning, if Docker is unavailable: `docs/runbooks/codegen-toolchain-host-setup.md`).
2. Commit the generated output only; do not edit it by hand.
3. Confirm the generated Go `MarketDataServiceClient` interface gained `GetSymbolServability`; the portfolio test stub `stubMarketData` (`services/xstockstrat-portfolio/internal/service/portfolio_service_test.go:18`) and the trading stub (`trading_sizing_test.go:32`) embed the interface, so they still compile.

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen | head -20
cd services/xstockstrat-marketdata && GOWORK=off go build ./... 2>&1 | head   # expect only the missing-method error until Step 5 (handler adapter)
grep -n "UNSERVABLE_REASON_OTC" packages/proto/gen/go/common/v1/common.pb.go packages/proto/gen/python/common/v1/common_pb2.py packages/proto/gen/ts/common/v1/common_pb.ts
```
A second `./scripts/buf-gen.sh` run must produce an empty `git diff` (freshness).

---

### Step 3 — service: config write-edge bounds for the two new keys

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming (`<service>.<category>.<key>`), environment / global-per-user scoping, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via: `grep -n "SCALAR_BOUNDS_REGISTRY" services/xstockstrat-config/src/grpc/configServiceImpl.ts` → registry at `:103`; sibling entry `'portfolio.marketdata.quote_timeout_ms': { minValue: 500, maxValue: 8000 }` at `:139`; `lookupScalarBounds` `:154-155` probes the bare `key` then `${namespace}.${key}`; enforced in `SetConfig` at `:557-563`.
- Neither new key exists: `grep -rn "marketdata.assets.refresh_interval_hours\|portfolio.marketdata.servability_timeout_ms" services docs --include=*.ts --include=*.go --include=*.md` → only this feature's own docs.
- Both keys are **unseeded** (feature-227 waiver, `docs/patterns/config-governance.md:144,155,169`): consumed-with-default, no migration row.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `SCALAR_BOUNDS_REGISTRY` add, with a one-line comment citing feature 282 (24h ceiling stays below the 48h `minIngestLookback`; the portfolio timeout floor/ceiling keeps the check cheap relative to the 4000ms quote deadline):
   - `'marketdata.assets.refresh_interval_hours': { minValue: 1, maxValue: 24 },`
   - `'portfolio.marketdata.servability_timeout_ms': { minValue: 500, maxValue: 4000 },`
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

**Covers**: `AC-24`

**Instructions**:
1. Append four rows to `TIMEOUT_KEY_FORMS`, mirroring the existing two-forms-per-key convention:
   - `{ ns: 'marketdata', key: 'assets.refresh_interval_hours', field: 'intVal', min: 1, max: 24 }`
   - `{ ns: 'marketdata', key: 'marketdata.assets.refresh_interval_hours', field: 'intVal', min: 1, max: 24 }`
   - `{ ns: 'portfolio', key: 'marketdata.servability_timeout_ms', field: 'intVal', min: 500, max: 4000 }`
   - `{ ns: 'portfolio', key: 'portfolio.marketdata.servability_timeout_ms', field: 'intVal', min: 500, max: 4000 }`
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

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency

**Codebase Evidence**:
- Source path: `MarketDataService.ListAssets` calls `s.registry.Get("")` then `src.ListAssets(ctx, req.AssetClass)` — `marketdata_service.go:1353-1363`; `source.DataSourceClient.ListAssets` `internal/source/source.go:18`; `Registry.Get("")` resolves `"alpaca"` `source.go:172-181`. `alpaca.Client.ListAssets` sends `status=active` (`internal/alpaca/client.go:521`) and skips `!a.Tradable` (`:548`); `asset_class` is appended when non-empty (`:522-524`). Reusing this path means `DataSourceClient` gains no method and the six test fakes (`fakeBackfillSource` `marketdata_service_test.go:703`, etc.) are untouched.
- Cache and poller templates: `etfFlagState` `internal/service/etf_flags.go:33-148` (mutex + map + `now` seam), `GetEtfFlags` batch-in/per-symbol-out `:62-78`; `StartClassificationRefreshPoller` `classification_service.go:224-247` (1-minute ticker, re-reads the interval each tick, `hours <= 0` → `continue`); `normalizeSymbols` (uppercase + trim, drops empties) `classification_service.go:97`.
- Config seam: `budgetCfg intGetter` (`marketdata_service.go:102`, set only when the watcher is non-nil at `:230-232`); `resolvePositiveInt` (`:986-993`) maps `<= 0` to the default, so it cannot express the "`<= 0` pauses" rule (MARKETDATA-5) — this step reads `s.budgetCfg.GetInt` directly. `config.Watcher.GetInt` returns the default when the key is unset (`internal/config/config.go:157-168`).
- Warm set: `warmMu`/`warmSymbols` `marketdata_service.go:47-50`; `markWarm` `:1088-1095` (does not normalize); `warmSnapshot` `:1099`; `StartWarmQuotePoller` copies `s.warmSymbols` inline `:1132-1137`.
- Handler pattern: `MarketDataHandler.GetEtfFlags` returns the service error unwrapped so connect codes survive (`marketdata_handler.go:159-167`); gRPC adapter `GetEtfFlags` `:360-366` maps via `toGRPCError`, which maps `connect.CodeInvalidArgument` → `codes.InvalidArgument` (`:496-515`). Handler embeds `marketdatav1connect.UnimplementedMarketDataServiceHandler` (`:19-23`).
- Startup wiring: pollers started with `go svc.Start…(ctx)` at `cmd/server/main.go:164-172`.
- Header propagation: no outbound gRPC added (Alpaca REST only), so C-03 is not triggered by this step.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `asset_servability.go` (new, package `service`). Fixed operator-approved invariants as unexported consts (F-07 precedent, recorded in `design.md`): `assetClassUSEquity = "us_equity"`, `assetExchangeOTC = "OTC"`, `assetShrinkKeepPercent = 50`, `assetRetryInitial = time.Minute`, `assetRetryMax = 30 * time.Minute`, `servabilityMaxSymbols = 1000`, `defaultAssetRefreshHours = 6`, `maxAssetRefreshHours = 24`, and the config key const `assetRefreshHoursKey = "marketdata.assets.refresh_interval_hours"`.
2. `type assetSet struct { otc map[string]bool }` (immutable after construction; normalized symbol → exchange is OTC). Constructor `newAssetSet(assets []*commonv1.Asset) *assetSet` (uppercase/trim symbol; `otc = strings.EqualFold(exchange, assetExchangeOTC)`). Method `(a *assetSet) classify(sym string) (servable bool, reason commonv1.UnservableReason)`: normalize (uppercase+trim); absent → `(false, UNSERVABLE_REASON_NOT_TRADABLE)`; present and OTC → `(false, UNSERVABLE_REASON_OTC)`; else `(true, UNSERVABLE_REASON_UNSPECIFIED)`. A nil `*assetSet` receiver returns servable (fail open).
3. `type assetServabilityState struct { snap atomic.Pointer[assetSet]; unloadedWarned bool }` (`unloadedWarned` is touched only by the refresher goroutine). Add field `assets assetServabilityState` to `MarketDataService` (`marketdata_service.go`, next to `etf etfFlagState` at `:~96`) so existing struct literals in tests keep a usable zero value (nil snapshot = servable).
4. `(s *MarketDataService) markWarmIfServable(symbols ...string) *assetSet`: take `warmMu`, **load the snapshot while holding the lock**, add each non-empty symbol to `warmSymbols` unless the snapshot is non-nil and marks it unservable, release, return the snapshot (the caller's live-fetch decision reuses it — one snapshot, one predicate per request). Do not change `markWarm` (the quote and price paths keep using it).
5. `(s *MarketDataService) GetSymbolServability(ctx, req *marketdatav1.GetSymbolServabilityRequest) (*marketdatav1.GetSymbolServabilityResponse, error)`: `len(req.GetSymbols()) > servabilityMaxSymbols` → `connect.NewError(connect.CodeInvalidArgument, …)`; normalize via `normalizeSymbols`; one snapshot load; for a nil snapshot return `AssetSetLoaded=false` with every symbol `Servable=true`; otherwise per-symbol `{Symbol, Servable, Reason}` via `classify`, `AssetSetLoaded=true`. In-memory only (no DB, no Alpaca call — feature 153 `@AC-1`).
6. `(s *MarketDataService) refreshAssets(ctx) error`: `src, err := s.registry.Get("")`; `assets, err := src.ListAssets(ctx, assetClassUSEquity)`; build `next := newAssetSet(assets)`; **reject** (return error, keep the last good set, log WARN with old/new counts) when `len(next.otc) == 0`, or when a prior snapshot exists and `len(next.otc)*100 < len(prev.otc)*assetShrinkKeepPercent`; the very first load has no prior set so the shrink guard does not protect it (design R3). On accept: `s.assets.snap.Store(next)`; on the **first** successful load only, take `warmMu` and delete every `warmSymbols` entry for which `next.classify(sym)` is unservable (path-agnostic), release, and log one INFO `asset set loaded` (count, pruned). No later refresh prunes (design R2).
7. `(s *MarketDataService) StartAssetSetRefresher(ctx)`: run `refreshAssets` immediately at boot (do not wait a tick); on the first failure while still unloaded log exactly one WARN (`asset set unavailable; treating every symbol as servable`) via `unloadedWarned`, then rely on backoff. Then loop on a 1-minute `time.Ticker` (MARKETDATA-5, mirrors `StartClassificationRefreshPoller`): each tick re-read `resolveAssetRefreshInterval(s.budgetCfg)`; interval `0` (paused) → `continue`; run `refreshAssets` when `time.Since(lastSuccess) >= interval` (or the retry deadline has passed); on failure double the retry delay from `assetRetryInitial` to `assetRetryMax`, on success reset it. Runs on the long-lived `main` ctx (background work carries no propagation headers by design).
8. `resolveAssetRefreshInterval(cfg intGetter) time.Duration`: nil cfg → 6h; `v := cfg.GetInt(assetRefreshHoursKey, 6)`; `v <= 0` → `0` (paused, keep the set); `v > 24` → 24h; else `v` hours.
9. `marketdata_handler.go`: add `(h *MarketDataHandler) GetSymbolServability` (copy the `GetEtfFlags` shape: return the service error unwrapped) after `GetEtfFlags` (`:159-167`) and `(a *grpcMarketDataAdapter) GetSymbolServability` after `:360-366`.
10. `cmd/server/main.go`: add `go svc.StartAssetSetRefresher(ctx)` after `go svc.StartEtfFlagFiller(ctx)` (`:170`).
11. Dry-run check: reuse `normalizeSymbols`; do not copy `etfFlagState`'s TTL/eviction machinery (no TTL, no per-entry state needed — one immutable snapshot).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "StartAssetSetRefresher" cmd/server/main.go
```

---

### Step 6 — test: marketdata asset set, servability RPC, refresher semantics

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/asset_servability_test.go` — create
- `services/xstockstrat-marketdata/internal/testdata/assets.go` — create

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- Test conventions: struct-literal service construction with a fake registry source (`marketdata_service_test.go:3173` `&MarketDataService{registry: reg, warmSymbols: map[string]struct{}{}, budgetCfg: cfg}`); `fakeIntGetter` / `budgetCfgMs` (`marketdata_service_test.go:1757`); `fakeBackfillSource.ListAssets` returns nil (`:714`) so a new fake source with a scripted `ListAssets` is needed; `funcBody` structural helper `:1062`.
- Go fixture home: `services/xstockstrat-marketdata/internal/testdata/marks.go` (package `testdata`, C-13). `etf_flags_test.go` is the closest template for a cache-state test file.
- C-13 verdict: the asset literals (`AAPL`/NASDAQ, `BOSSY`/OTC, `ZZZZ`, DNB absent) have **two consumers** (this step and Step 8), so they live in `internal/testdata/assets.go` from the start.

**TDD**: `red-green required` (fails to compile / assert against the tree before Step 5)

**Covers**: `AC-1, AC-9, AC-10, AC-11, AC-15, AC-22, AC-23, AC-24`

**Instructions**:
1. `internal/testdata/assets.go`: exported constants for the symbols (`Bossy`, `Crtd`, `Forl`, `Dnb`, `Zzzz`, reuse `Msft` from `marks.go`, add `Aapl` only if absent) and a builder `ServableAssets() []*commonv1.Asset` returning AAPL (`NASDAQ`), MSFT (`NASDAQ`), ZZZZ (`NASDAQ`), BOSSY and CRTD (`OTC`), and `FORL` (`OTC`); DNB deliberately absent. No domain data is declared inline in the test files.
2. `asset_servability_test.go`, one test per scenario, each naming its `@AC-N`:
   - AC-1: `GetSymbolServability` on a loaded set → AAPL servable; BOSSY `UNSERVABLE_REASON_OTC`; DNB `UNSERVABLE_REASON_NOT_TRADABLE`; `AssetSetLoaded == true`.
   - AC-23: `" bossy "` classifies as BOSSY in `GetSymbolServability` and in `classify`.
   - AC-22 (marketdata half): 1001 symbols → `connect.CodeOf(err) == connect.CodeInvalidArgument`; exactly 1000 succeeds.
   - AC-9: nil snapshot → `GetSymbolServability` returns `AssetSetLoaded == false` and every symbol servable; `markWarmIfServable("BOSSY")` adds it; the refresher logs exactly one unloaded WARN across several failed attempts (capture with a `slog` handler; assert count == 1).
   - AC-10: after a good load, a `ListAssets` error leaves BOSSY unservable and AAPL servable (`refreshAssets` returns error, snapshot pointer unchanged); assert the retry delay doubles 1m → 2m → … capped at 30m (extract the delay step as a small pure function in Step 5 if needed to test without sleeping).
   - AC-11: with a 10-asset set loaded, a refresh returning 4 assets is rejected and a WARN is logged; an empty refresh is rejected the same way; a 5-of-10 refresh (exactly 50%) is accepted.
   - AC-15: warm `BOSSY` and `AAPL` via `markWarm` while unloaded; first successful load that lists AAPL but not BOSSY removes BOSSY and keeps AAPL; a **later** refresh that stops listing AAPL does not remove it from the warm set.
   - AC-24: `resolveAssetRefreshInterval` with a `fakeIntGetter` → `0` → paused (returns 0), `48` → 24h, key unset → 6h, `nil` cfg → 6h.
3. Use `source.NewRegistry().Register("alpaca", fake)` with a fake whose `ListAssets(ctx, "us_equity")` is scripted and records the asset class it was asked for (assert `"us_equity"`).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
grep -rn "Bossy\|BOSSY" --include="*_test.go" internal | head   # C-13: asset literals only via internal/testdata
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
- `markWarm` call sites confirmed via `grep -n "markWarm" services/xstockstrat-marketdata/internal/service/marketdata_service.go`: `GetBars :262`, `GetLatestQuote :545`, `GetLatestQuotes :575`, `GetLatestPrice :688`, `BatchGetBars :749`, `BatchGetLatestPrice :868`. Only the first, fifth and sixth are gated; `GetLatestQuote(s)` and `GetLatestPrice` stay on `markWarm` (held positions stay priced, feature 178 `@AC-3`).
- `GetBars`: live-fetch fallback `if pageToken == "" { refetch := len(bars) == 0 … if refetch { … s.fetchAndCacheBars(…) … else if len(bars) == 0 { slog.WarnContext(ctx, "GetBars: no bars stored and live fetch returned none" … } } }` at `:312-332`.
- `BatchGetBars`: `for _, sym := range req.Symbols { s.markWarm(sym) }` at `:748-750`; cold list built from the `warm` map at `:763-768`; singleflight key from `sortedCold` `:770-772`; `partialColdFetch(ctx, key, cold, fetch)` at `:~809` (its WARN prints `cold`); strict path `s.barsSingleflight.Do(key, …)` returns the fetch error.
- `BatchGetLatestPrice`: `markWarm` loop `:867-869`; flight key `"batch-price:" + strings.Join(sorted, ",")` from the full request `:871-874`; previous-close read `GetPreviousDailyCloseBatch(fctx, req.Symbols)` `:893`; trade fetch `GetLatestTradesMulti(fctx, req.Symbols)` `:908-945` with per-symbol fallback over `req.Symbols`; response loop omits a symbol with neither trade nor previous close and leaves `LastPrice`/`LastTradeTime` unset when only a previous close exists `:964-979`.
- Existing structural test that pins the call: `TestGetBarsMarksSymbolWarm` (`marketdata_service_test.go:914-924`) source-scans for `s.markWarm(req.Symbol)` — updated in Step 8.
- Analysis consumer never treats a present entry as a live price: `HasField("last_price")` and no memoization of a missing price (`services/xstockstrat-analysis/app/handlers/servicer.py:4788,4803`, per design) — no analysis change.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. `GetBars`: replace `s.markWarm(req.Symbol)` (`:262`) with `snap := s.markWarmIfServable(req.Symbol)` and `unservable := snap != nil && !servableOf(snap, req.Symbol)` (small helper `(*assetSet).servable(sym) bool` over `classify`, nil-safe). Wrap the existing `if refetch { … }` body (`:312-332`) as `if refetch && !unservable { … }`, keeping the inner `slog.WarnContext(ctx, "GetBars: no bars stored and live fetch returned none" …)` text intact. An unservable symbol still gets its stored bars; a miss returns the empty valid `GetBarsResponse` exactly as today, with no live fetch and no WARN (the noise this feature removes).
2. `BatchGetBars`: replace the `markWarm` loop (`:748-750`) with `snap := s.markWarmIfServable(req.Symbols...)`. When building `cold` (`:763-768`) skip any symbol the snapshot marks unservable, **before** `sortedCold` and the singleflight key. If `cold` ends up empty no flight runs and strict and partial calls succeed with the stored bars only. `partialColdFetch` receives the filtered `cold`, so its WARN does not report unservable symbols.
3. `BatchGetLatestPrice`: replace the `markWarm` loop (`:867-869`) with `snap := s.markWarmIfServable(req.Symbols...)`. Keep the flight key on the **full** sorted request (`:871-874`: callers that differ only in unservable members must not share a leader's previous-close map). Inside the closure compute `tradeSyms` = the servable subset of `req.Symbols` and use it for both the `GetLatestTradesMulti` call and the per-symbol fallback loop (`:908-945`), skipping the whole trade section when `tradeSyms` is empty; the previous-close read (`:893`) still covers `req.Symbols`. An unservable symbol with a stored previous close is therefore returned with `prev_close` only; one without is omitted (existing omit rule, `:964-979`). `n` in the log fields stays `len(req.Symbols)`.
4. Add a comment at `markWarmIfServable`'s definition (Step 5) and nowhere else: "gate applies at warm-add sites only; warm-set readers are never filtered". Do not touch `warmSnapshot` (`:1099`), the `StartWarmQuotePoller` inline copy (`:1132-1137`), `ingestRecentBars`, or `classificationUniverse`.
5. Header propagation: no outbound gRPC calls added.

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "markWarm(\|markWarmIfServable(" internal/service/marketdata_service.go   # exactly 3 markWarmIfServable sites (GetBars, BatchGetBars, BatchGetLatestPrice); 3 markWarm sites remain (GetLatestQuote, GetLatestQuotes, GetLatestPrice)
```

---

### Step 8 — test: marketdata gate (GetBars, BatchGetBars, BatchGetLatestPrice, ungated paths)

**Status**: `pending`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/internal/service/marketdata_service_test.go` — modify

**Reviewers**: Service owner `xstockstrat-marketdata` — OHLCV ingestion integrity, Alpaca feed idempotency

**Codebase Evidence**:
- `TestGetBarsMarksSymbolWarm` (`marketdata_service_test.go:914-924`) asserts `s.markWarm(req.Symbol)` in `GetBars`'s body via `funcBody` (`:1062`); `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` (`:929-938`) asserts the WARN string stays — both structural because `GetBars` needs a live DB pool.
- f240 fixtures to extend: `fakeBarsStore` serves AAPL's 3 bars (`:3869-3879`), `scriptedBarsSource` counts cold fetches (`:3882-3892`), `partialSvc` builds the service (`:3896-3901`), `batchReq` uses symbols AAPL + MSFT (`:3903-3909`), `hangUntilDone`, `assertOnlyWarmAAPL`, and tests `TestBatchGetBars_AC53_*` / `AC54_*` (`:3933-3960`). Price fakes: `fakeBatchPriceSource` / `fakeLatestTradeOnlySource` (`:1500-1560`), `TestBatchGetLatestPrice_MultipleSymbols` (`:1572`) with `prevClose prevCloseReader` seam on the service.
- Quote tests: `newQuoteSvc` / `fakeQuoteStore` (`:3175-3210`) for the ungated quote-path scenario.
- C-13 verdict: asset literals come from `internal/testdata/assets.go` (Step 6), the second consumer; the symbol names `FORL`, `BOSSY`, `ZZZZ` are not redeclared inline.

**TDD**: `red-green required` (run before Step 7: unservable symbols are still warmed and fetched, so the new assertions fail)

**Covers**: `AC-4, AC-7, AC-12, AC-13, AC-14, AC-16, AC-17, AC-23, AC-26`

**Instructions**:
1. Update `TestGetBarsMarksSymbolWarm` to require `s.markWarmIfServable(req.Symbol)` in `GetBars`'s body (and still that the body contains no bare `s.markWarm(`), and extend it with a structural assertion that the `refetch` branch is guarded by the unservable flag (`refetch && !unservable`). Keep `TestGetBarsWarnsWhenMissAndLiveFetchEmpty` passing unchanged.
2. Add `TestMarkWarmIfServable_*`: with a loaded set (`svc.assets.snap.Store(newAssetSet(testdata.ServableAssets()))`) `markWarmIfServable("BOSSY","AAPL")` adds only AAPL and returns the same snapshot (AC-4 warm half, AC-7 for DNB, AC-23 for `" bossy "`); with a nil snapshot both are added.
3. AC-12: new test using `partialSvc`-style construction with the asset set loaded (AAPL, ZZZZ listed; BOSSY not), `barsStore: fakeBarsStore{}`, a source whose cold fetch returns an error and counts calls; `BatchGetBars` for AAPL + BOSSY with `AllowPartial: false` succeeds with AAPL only and 0 live fetches. Also assert a **pinned** variant for R4: with ZZZZ servable in the loaded set, strict still returns the plain source error (`errors.Is(err, errColdFetch)`), so `@AC-53 @feature-240` remains meaningful.
4. AC-14: asset set loaded (AAPL, ZZZZ listed); the cold fetch for ZZZZ blocks (`hangUntilDone`); `BatchGetBars` for AAPL, ZZZZ, BOSSY with `AllowPartial: true` under a 1000ms context deadline returns within the deadline with the stored AAPL bars; the recording source saw `ZZZZ` requested and `BOSSY` not (record the symbols argument of `GetBarsMulti` in a new wrapper type; do not change `scriptedBarsSource`'s existing signature used by other tests).
5. AC-13: `svc.prevClose` fake with BOSSY previous close 9.9 and no AAPL previous close; `fakeBatchPriceSource` with an AAPL trade only; `BatchGetLatestPrice` for AAPL + BOSSY returns AAPL with `LastPrice`, BOSSY with `PrevClose` set and `LastPrice == nil`, BOSSY not in the warm set, and the source's trade request never contained BOSSY; a symbol with neither is omitted. Also assert the singleflight key is built from the full set (two concurrent calls differing only in an unservable member do not share a previous-close map).
6. AC-16: with BOSSY unservable, `GetLatestQuotes`, `GetLatestQuote` (and `GetLatestPrice` where its fake allows) each add BOSSY to the warm set and their live fetch behaviour is unchanged (BOSSY is requested from the source).
7. AC-17 (marketdata half) and AC-26: warm `FORL` through `GetLatestQuotes` after the asset set is loaded and lists FORL as OTC → it stays warm across a later `refreshAssets` (no prune after first load); and a symbol warmed while unloaded then pruned by the first load is re-added by the next `GetLatestQuotes` call.
8. Use existing fakes; any new helper is private to this file. No new `INVENTORY.md`-style catalog applies (Go).

**Verification**:
```bash
cd services/xstockstrat-marketdata && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
grep -rn "FORL\|\"BOSSY\"" --include="*_test.go" internal | head   # ≤ 1 declaration site per literal (C-13)
```
New logic is in an excluded package (`service/`) — no coverage threshold applies; behavior is proven by the tests above.

---

### Step 9 — service: portfolio servability filter on the three watchlist insert paths

**Status**: `pending`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go` — modify

**Reviewers**: Service owner `xstockstrat-portfolio` — P&L calculation accuracy, position snapshot consistency, concurrent write safety

**Codebase Evidence**:
- Call sites: `CreateWatchlist` (`portfolio_service.go:1905`; `bindings := requestBindings(req.GetBindings(), req.GetSymbols(), req.GetDefaultStrategyId())` then `len(bindings) > s.maxSymbolsPerList()` → `InvalidArgument`, then `s.watchlists.Create(…)`); replace-all `UpdateWatchlist` legacy branch (`:2010`, after the mask branch `:2019-2052` returns; `requestBindings(req.GetBindings(), req.GetSymbols(), "")` at `~:2064`, cap check, `s.watchlists.Update(…)`); `AddWatchlistSymbols` (`:2166`; `add := requestBindings(…, existing.GetDefaultStrategyId())`, `resulting := normalizeSymbols(append(existing.Symbols…, bindingSymbols(add)…))`, cap check `:2179-2183`, `s.watchlists.AddSymbols`).
- `requestBindings` (`:1830`, free function — cannot call a service method), `normalizeSymbols` (`:1788`), `normalizeBindings` (`:1807`, preserves `Source`), `applyDefaultStrategy` (`:1847`, skips SIGNAL), `bindingSymbols` (`:1860`).
- Fail-open template: `latestQuotesFor` bounded by `quoteTimeout()` with WARN and `ok=false` (`:402-432`); `quoteCfg intConfig` field `:52-53`, assigned only when the watcher is non-nil `:164-167`; `intConfig` interface `:1781-1784`.
- Client and header propagation: marketdata dial with `grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor)` at `portfolio_service.go:138`; `UnaryClientInterceptor` injects `x-user-id`/`x-access-scope`/`x-trace-id` (`internal/middleware/propagation.go:39-50`). The new call reuses `s.marketdata`, so it already carries the three headers over the existing mTLS edge.
- Never classify: masked `UpdateWatchlist` branch, `UpdateWatchlistBinding` (`:2080`), `UpdateWatchlistBindings` (`:2112`, rebind-only), `EnsureSignalWatchlist` (`:1939`, takes no symbols), `RemoveWatchlistSymbols`.
- Test seam: `newSvc` in `watchlist_service_test.go:275` leaves `marketdata` nil, so every existing watchlist test runs without a marketdata client — the helper must treat a nil client as "servability unavailable" and let the write through.
- Only INSERT site: `insertBindingsTx` `internal/repository/watchlist_repo.go:494`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. Add `const defaultServabilityTimeoutMs = 2000` and `(s *PortfolioService) servabilityTimeout() time.Duration` reading `portfolio.marketdata.servability_timeout_ms` through `s.quoteCfg` (nil → 2000ms; value `< 500` or `> 4000` or `<= 0` → clamp: `<= 0` → default, `< 500` → 500, `> 4000` → 4000), modelled on `quoteTimeout()` (`:422-432`) without copying more than the lookup; if the shared part grows beyond the timeout lookup, extract the wrapper instead (dry-reviewer).
2. Add `(s *PortfolioService) refuseUnservable(ctx, bindings []*portfoliov1.WatchlistBinding) (accepted []*portfoliov1.WatchlistBinding, refused []*portfoliov1.RefusedSymbol)`:
   - empty input, or `s.marketdata == nil` → return the input unchanged, no refusals (nil client = unavailable; no WARN in the nil-client test path).
   - Build the symbol list with `bindingSymbols`; call `s.marketdata.GetSymbolServability(qctx, &marketdatav1.GetSymbolServabilityRequest{Symbols: …})` under `context.WithTimeout(ctx, s.servabilityTimeout())` (reuses the propagating client — C-03).
   - On any error, timeout, or `AssetSetLoaded == false`: log `slog.WarnContext(ctx, "symbol servability unavailable; allowing write", "count", …, "error", …)` and return the input unchanged (fail open, FR-5, AC-6, AC-22). Do not add a client-side size constant (see Step Dependencies decision (b)); an oversize request fails open through the RPC `InvalidArgument`.
   - Otherwise partition `bindings` by the response (`Servable == false` → refused with its `Reason`), preserving order and each accepted binding's `Source` and `StrategyId`.
3. Wire the three paths **after** `requestBindings` (and so after `applyDefaultStrategy`, so defaults land on accepted symbols only) and **before** the cap check and the repository call:
   - `CreateWatchlist`: `bindings, refused := s.refuseUnservable(ctx, bindings)`; cap check on the accepted count; return `&CreateWatchlistResponse{Watchlist: wl, RefusedSymbols: refused}`. A create where every symbol is refused still creates the (empty) list.
   - Replace-all `UpdateWatchlist` (no-mask branch only): same pattern; a stored unservable symbol resubmitted by a name-only read-modify-write is dropped and reported (AC-19, operator sign-off in `context.md`). Return `RefusedSymbols: refused` on the response.
   - `AddWatchlistSymbols`: `add, refused := s.refuseUnservable(ctx, add)`; compute the cap on the **post-filter** union (`existing.Symbols` mirror ∪ accepted symbols, `:2179-2183`), so a request that fits after refusals succeeds (AC-25, FR-2); when `len(add) == 0` skip `s.watchlists.AddSymbols` and the ledger event and return `existing` with `RefusedSymbols: refused`; otherwise proceed as today and attach `RefusedSymbols`.
4. The filter is uniform on every submitted symbol: no stored-versus-new special-casing (operator steer, `context.md`).
5. `ListAllWatchlistSymbols`, reads, and every masked/rebind RPC stay untouched.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "refuseUnservable\|UnaryClientInterceptor" internal/service/portfolio_service.go   # 3 call sites + the propagating client dial
```

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
- C-13 verdict: `CRTD`/`MSFT`/`BOSSY` literals are single-consumer inline in `watchlist_service_test.go`; the stub's fields are the shared seam. No `internal/testdata/` home exists in portfolio; none is created.

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
   - Defaults: `default_strategy_id` set, bare MSFT + CRTD → MSFT bound to the default, CRTD refused (EXTEND `@AC-7/@AC-10 @feature-170`).
3. AC-17 (portfolio half), in `offline_valuation_test.go`: an offline position in an unservable symbol (e.g. FORL with a stored 1d close via `stub.bars`) with `stub.unservable` set; `ListPositions` still requests FORL via `GetLatestQuotes` (`stub.requested` contains FORL) and values it from the quote or the stored close; `servabilityCalls == 0` (reads never classify).
4. Existing watchlist tests (nil `marketdata`) must pass unmodified: they prove the nil-client fail-open path.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
grep -rn "\"CRTD\"" --include="*_test.go" internal | head   # ≤ 1 file declares the literal (C-13 single consumer)
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
cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest tests/test_watchlist_client.py tests/test_watchlist_tools.py tests/test_ingest_signal_watchlist.py tests/test_tool_deadlines.py --cov=app --cov-report=term -q
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
- Rename: `commitRename` (`WatchlistDetail.tsx:126-134`) currently sends `{watchlistId, name, description, bindings}` (replace-all); the masked path already exists as `setDefaultStrategy` → `updateWatchlist.mutate({ watchlistId, updateMask: ['default_strategy_id'], … })` (`:139-146`); `useUpdateWatchlist` maps `updateMask` to `{ paths: input.updateMask }` (`src/hooks/useWatchlists.ts:76-84`).
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
4. `screener.spec.ts`: Save-as (`createWatchlist`) and Add top N (`addWatchlistSymbols`) tests with `MOCK_UNSERVABLE` → MSFT added, the shared notice lists CRTD with its reason (AC-20).
5. Run the specs scoped (`--project=chromium --no-deps`) after manually pre-warming the `/insights/watchlists` and `/insights/screener` routes (ledger e2e pre-warm note).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run test:unit
cd services/xstockstrat-ui && pnpm exec playwright test e2e/insights/watchlists.spec.ts e2e/insights/screener.spec.ts --project=chromium --no-deps
grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth\|watchlistMock" e2e/insights/watchlists.spec.ts e2e/insights/screener.spec.ts | head
grep -n "MOCK_UNSERVABLE" e2e/fixtures/INVENTORY.md
```

---

### Step 15 — docs: runbook, CLAUDE.md files, constitutions, registered keys

**Status**: `pending`
**Service**: `docs/runbooks/`, `docs/patterns/`, service docs
**Files**:
- `docs/runbooks/mcp-tools.md` — modify (`ingest_signal` `:224-255`, `manage_watchlist` / `manage_watchlist_symbols` `:1263-1335`)
- `services/xstockstrat-agent/CLAUDE.md` — modify (tool table rows `:~82-83`, watchlist section `:~134`)
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (config table near `:85`, asset-set section near `:168-175`)
- `services/xstockstrat-marketdata/docs/context-constitution.md` — modify (new `MARKETDATA-*` invariant)
- `services/xstockstrat-portfolio/CLAUDE.md` — modify (config table near `:110`, watchlist section)
- `services/xstockstrat-portfolio/docs/context-constitution.md` — modify (new `PORTFOLIO-*` invariant)
- `docs/patterns/config-governance.md` — modify (append a Per-Feature Registered Keys entry)

**Reviewers**: none

**Codebase Evidence**:
- Doc parity is test-enforced for the watchlist tools: `tests/test_watchlist_tools.py:312-322` requires the runbook headings; `docs/runbooks/mcp-tools.md` anchors confirmed at `### \`ingest_signal\`` (~L224), `### \`manage_watchlist\`` and `### \`manage_watchlist_symbols\`` (~L1263-1335).
- Config tables: marketdata `CLAUDE.md:85` lists `marketdata.classification.refresh_interval_hours`; portfolio `CLAUDE.md:110` lists `portfolio.marketdata.quote_timeout_ms`; the Per-Feature Registered Keys log is append-only, newest first (`docs/patterns/config-governance.md:109-111`), and feature 229's entry (`:165-181`) is the table format to follow.
- Constitutions: marketdata `MARKETDATA-*` rows (`docs/context-constitution.md:16-33`, `MARKETDATA-5` pause rule); portfolio `PORTFOLIO-*` rows (`:20-33`).
- Root `CLAUDE.md` § Teardown: a session that changed context files must run `/context-forge:context-constitution refresh` scoped to the touched files, or reconcile by hand and record it in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. `mcp-tools.md`: `ingest_signal` — add `watchlist_refused` (present only when non-empty) to **Return**, an **Errors** row (unservable symbol: skipped, ingest still succeeds), and the R7 note; `manage_watchlist` / `manage_watchlist_symbols` — **Returns** `{"watchlist": …, "refused": [{symbol, reason}]}`, reason names, "refused = not newly added", a name-only replace-all update drops and reports a now-unservable stored symbol. Mirror every statement in the tool docstrings (Step 11) and the agent `CLAUDE.md` rows.
2. Marketdata `CLAUDE.md`: config row `marketdata.assets.refresh_interval_hours` (int, default `6`, SetConfig bounds `[1,24]`, clamped on read, `<= 0` pauses, unseeded); an "Asset-set servability" section stating the predicate (absent from the active+tradable `us_equity` set, or exchange `OTC`), the fixed invariants (shrink guard 50%, backoff 1m→30m, RPC bound 1000, immediate first load, first-load-only warm prune, accepted residuals R2/R3), and the gate's scope (warm-add sites only).
3. Marketdata `docs/context-constitution.md`: new `MARKETDATA-15` — "the unservable gate applies at warm-add sites only (`markWarmIfServable` in `GetBars`/`BatchGetBars`/`BatchGetLatestPrice`); warm-set readers and the quote/price paths are never filtered", with the held-position coupling (R11: portfolio always quotes offline positions via `GetLatestQuotes`, `trading.go:1074` publishes `current_price: 0`) and the guard tests. Portfolio `CLAUDE.md` + `docs/context-constitution.md`: config row `portfolio.marketdata.servability_timeout_ms` (int, `2000`, bounds `[500,4000]`, clamped, unseeded) and new `PORTFOLIO-15` — "servability is asked of marketdata (never re-derived from `Asset.exchange`), uniform on every submitted symbol on Create/replace-all Update/AddWatchlistSymbols, fail-open with WARN, cap on the post-filter union; masked/rebind/Ensure RPCs and reads never classify".
4. `docs/patterns/config-governance.md`: append a "feature 282 — filter-otc-symbols" entry at the top of the Per-Feature Registered Keys log with both keys, defaults, bounds, unseeded (227 D2 precedent), owner + config-team approval.
5. Teardown: run `/context-forge:context-constitution refresh` scoped to the touched context files; if the plugin is unavailable, re-read each touched file against the final code, reconcile drift, and record both facts in the PR body.

**Verification**:
```bash
grep -n "watchlist_refused\|refused" docs/runbooks/mcp-tools.md services/xstockstrat-agent/CLAUDE.md | head
grep -n "marketdata.assets.refresh_interval_hours\|portfolio.marketdata.servability_timeout_ms" services/xstockstrat-marketdata/CLAUDE.md services/xstockstrat-portfolio/CLAUDE.md docs/patterns/config-governance.md
cd services/xstockstrat-agent && pytest tests/test_watchlist_tools.py -q -k doc_parity
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
