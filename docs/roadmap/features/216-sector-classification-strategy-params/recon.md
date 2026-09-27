# Recon: sector-classification-strategy-params

**Created**: 2026-09-27
**From**: product-spec.md
**Affected services**: xstockstrat-marketdata, xstockstrat-analysis, xstockstrat-indicators, xstockstrat-agent, xstockstrat-ui, packages/proto

---

## Objective

Add a point-in-time (Type-2 SCD) GICS-sector classification store in `xstockstrat-marketdata`, fed by
a single rate-limited FMP gateway, and let a strategy carry per-sector formula parameter overrides
that `xstockstrat-analysis` resolves as-of each evaluated bar during scoring and backtesting — with a
mandatory default bucket for unknown sectors and byte-for-byte parity when no overrides are declared.

## Codebase Map

- **`xstockstrat-marketdata`** (Go)
  - Entry point / startup wiring: `cmd/server/main.go:40` (telemetry), `:54,59` (config Watcher + `WaitForSnapshot`), `:80` (`resolveSecret("fmp.api_key")`), `:145-147` (poller goroutines), `:210-213` (`newFundamentalsSource` builds FMP client)
  - FMP client: `internal/fmp/fmp_client.go:30,38` (struct + ctor); endpoints `:151,161,174`; **no rate limiter today**
  - Canonical rate limiter to reuse: `internal/alpaca/client.go:15` (import), `:70-72` (`rate.NewLimiter`), `:86-88` (`limiter.Wait` in shared `do()`)
  - Config Watcher: `internal/config/config.go:55,69` (Watcher/ctor), `:207-238` (WatchConfig+merge), `:126` (WaitForSnapshot 90s), typed getters `:138,152,166,180`; `ResolveSecret` `:109`
  - Background job template: `internal/service/marketdata_service.go:801` (`StartWarmQuotePoller`), `:876` (`StartBarIngestPoller`) — ticker loops, re-read interval per tick, `interval<=0` pauses
  - `ListAssets`: `internal/alpaca/client.go:520`; service `:1010-1019`; handler `internal/handler/marketdata_handler.go:180,316`; source iface `internal/source/source.go:17`
  - Repo pattern: `internal/repository/marketdata_repo.go:29-35` (`MarketDataRepo`+`execer`), `pool.go:18-34` (`newPool`, `DB_POOL_MAX` default 2, PgBouncer guard); pgxmock tests `marketdata_repo_test.go:11,19-60`
  - Last migration: `006_dividend_actions.up.sql` (`services/xstockstrat-marketdata/migrations/`) → **next = 007**
  - Telemetry: `internal/telemetry/otel.go:18`
- **`xstockstrat-analysis`** (Python)
  - Servicer: `app/handlers/servicer.py` — `RunBacktest` `:635`, `_backtest_symbol_definition` `:1700`, per-bar decision loop `:1791`, legacy SMA loops `:1307,1338`, `ManageStrategy` `:2591` (JSONB serialize `:2631-2640`)
  - Strategy persistence: JSONB `definition_json` in `analysis.strategies` — `app/repositories/strategies.py:6-8,41-54`; table `migrations/001_strategies.up.sql`
  - **Component compute seam (critical)**: `app/services/evaluator.py:398` (`_compute_component`, `dict(comp.params)`), `:414` (builtin params), `:423-429` (formula `input_params`), `:587` (`_assemble_component_series` — single unit behind backtest/live/readiness); series computed **once over whole window** then `evaluate_with_series` `:1730-1732`
  - marketdata client: stub `servicer.py:400`; paged GetBars `_fetch_bars_paged` `:1124-1178`; header trio `:656-660`, `metadata=propagation_meta` `:1155`
  - Coverage gate: `--cov-fail-under=40` (`CLAUDE.md:416`)
- **`xstockstrat-indicators`** (Python)
  - `ExecuteFormula`: `app/handlers/servicer.py:113`; resolve `:141-143`; sandbox handoff `:178` (`params=resolved_params`)
  - Params are a **flat name→value dict**: `app/services/parameters.py:156-182`; sandbox binds `params` global `app/services/sandbox.py:162,165,181`
  - Proto param field: `packages/proto/indicators/v1/indicators.proto:74` (`input_params` Struct)
  - Coverage gate: `50` (`.github/workflows/ci.yml:341`)
- **`xstockstrat-agent`** (Python)
  - `manage_strategy` tool `app/tools.py:870`, merge-mask `supplied` dict `:994`; client proto map `app/client.py:849,879`, Struct precedent (`signal_params`) `:895`
  - `run_backtest` tool `app/tools.py:734`; client `:557`; view builder `app/backtest_view.py:54`, key allowlists `:36,38`; **descriptor-parity guard** `tests/test_backtest_view.py:189`
  - Sibling parity tests: `tests/test_opportunity_projection.py`, `tests/test_signal_source_projection.py`
  - mcp-tools.md parity + six inventory surfaces: `docs/runbooks/mcp-tools.md:447,280`; six surfaces enumerated `docs/roadmap/ledger/insights.md:2660`
- **`xstockstrat-ui`** (Next.js)
  - Strategy editor EXISTS in `/insights`: `src/app/insights/strategies/new/page.tsx:18`, `[id]/edit/page.tsx:35`, component `src/components/insights/StrategyWizard.tsx:104` (4 steps); per-component params `src/components/insights/ComponentEditor.tsx:41` (`params: Record<string,number>`)
  - Backtest render: `src/app/insights/strategies/[id]/page.tsx:562-628`; `src/components/insights/BacktestDiagnostics.tsx:71`
  - **Exhaustive `Record<Enum,…>` maps** (proto-enum add breaks `tsc`): `BacktestDiagnostics.tsx:17,25,31,40`; `formulaReference.ts:177`
  - BFF: `src/lib/insightsBff.ts:30` (`AnalysisService`: `manageStrategy` :46, `runBacktest` :38); route `src/app/insights/api/[...connect]/route.ts`
  - Nav: `PLATFORM_SUBNAV` `src/components/shared/PlatformHeader.tsx:69` (+ `navGroups.tsx`)
  - Fixtures: `e2e/fixtures/strategies.ts`, `e2e/fixtures/backtests.ts`, `e2e/fixtures/INVENTORY.md`; tokens `src/app/globals.css:8`
- **`packages/proto`**
  - `analysis.proto`: `StrategyDefinition:324` (max `signal_eligible=14` → **next 15**), `StrategyComponent.params=5` (`:313`), `BacktestResult:116` (max `fill_model=20` → next 21), `NoTradeReason:189` (next 5)
  - `marketdata.proto:12-63` (18 RPCs, request/response-pair style); `common/v1/common.proto:35-39` (`Asset`, no sector); no `Sector` enum anywhere

## Patterns to REUSE

- FMP rate limiting → reuse the Alpaca client's `golang.org/x/time/rate` limiter + `do()` chokepoint (`internal/alpaca/client.go:70-72,86-88`); FMP has none today.
- FMP credential → reuse `ResolveSecret`/`GetSecret` (`internal/config/config.go:109`, `main.go:80`) keyed `marketdata.fmp.api_key`; never an env var.
- Classification refresh job → reuse the ticker-poller template (`marketdata_service.go:801,876`) wired as a goroutine in `main.go:145-147`.
- New `marketdata.classification.*` config → reuse Watcher typed getters (`config.go:138-180`).
- SCD read repo → reuse `MarketDataRepo`/`execer` + pgxmock test pattern (`marketdata_repo.go`, `marketdata_repo_test.go`).
- Per-sector param storage → ride the existing `analysis.strategies` JSONB (`definition_json`) with **no migration** (feature 132/133 precedent: `denied_symbols`/`signal_eligible` ride JSONB).
- Per-sector param injection → substitute the resolved dict at `evaluator.py:398` `_compute_component` (`dict(comp.params)`); indicators param channel is already a flat map (`parameters.py`, `sandbox.py:165`) — drop-in.
- analysis→marketdata as-of call → mirror `_fetch_bars_paged` header-propagation (`servicer.py:1155`, `metadata=propagation_meta`).
- agent `manage_strategy` new field → mirror the `signal_params` Struct mapping (`client.py:895`) + add to the `supplied` merge-mask (`tools.py:994`); update `backtest_view.py` allowlists guarded by `test_backtest_view.py:189`.
- UI authoring → extend `StrategyWizard`/`ComponentEditor` (`params: Record<string,number>` precedent); reuse `e2e/fixtures/strategies.ts`; design-role tokens only (C-17).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-4 @FR-3 @FR-7 @feature-211` "P/B computed at the filing boundary, no look-ahead" (`services/xstockstrat-marketdata/acceptance/edgar-fundamentals-enrichment.feature`) — the FMP-sourced SCD-2 sector as-of read must use only data effective ≤ queried date.
- **PRESERVE** `@AC-5 @FR-4 @FR-7 @feature-211` "trailing-window excludes post-filing data" (same file) — secondary as-of discipline the effective-dating mirrors.
- **PRESERVE** `@AC-6/@AC-7 @feature-147` "vendor credential from config via GetSecret; missing cred warns but still starts" (`services/xstockstrat-marketdata/acceptance/config-secrets-and-scoping.feature`) — reuse `marketdata.fmp.api_key`, never reintroduce `FMP_API_KEY`.
- **PRESERVE** `@AC-1 @AC-2 @regression @feature-153` "400-day bars query locks few enough chunks (no SQLSTATE 53200)" (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature`) — **REGRESSION RISK**: sector resolution over a 400-day backtest window must not re-exhaust the lock table; a sector-history hypertable must respect the chunk-lock budget, and the join must be pre-resolved/batched, not per-bar.
- **PRESERVE** `@AC-3 @FR-2 @feature-151` "signal on the final bar introduces no look-ahead" (`services/xstockstrat-analysis/acceptance/backtest-next-bar-fill.feature`) — as-of sector resolution never references a sector effective after the bar.
- **PRESERVE** `@AC-4 @AC-10 @FR-3 @feature-151` "legacy fill remains byte-for-byte" (same file) — a strategy with no per-sector overrides is byte-identical.
- **PRESERVE** `@AC-1 @AC-2 @AC-3 @regression @feature-149` "annualized return / evidence cells / derived grade unchanged" (`services/xstockstrat-analysis/acceptance/fix-backtest-annualized-return.feature`) — per-sector params change inputs but must not perturb the metrics/annualization math.
- **PRESERVE** `@AC-2 @FR-1 @FR-3 @feature-152` "component value at bar t uses only data ≤ t" (`services/xstockstrat-analysis/acceptance/market-regime-benchmark-operand.feature`) — direct precedent: sector-as-of resolver is strictly PIT per bar.
- **PRESERVE** `@AC-3 @FR-2 @feature-152` "missing per-bar value → hold/false, never forward-filled" (same file) — the default-bucket fallback must be a deterministic fixed default, **not** a forward-fill of last-known sector across an SCD boundary.
- **PRESERVE** `@AC-1/@AC-5/@AC-7 @feature-152` "empty operand byte-for-byte / warmed-window reproducible / live resolves same component as backtest" (same file) — no-override parity; deterministic reproducibility; backtest/live parity (live = current snapshot).
- **EXTEND** `@AC-6 @FR-5 @feature-152` "manage_strategy normalizes field and folds into fingerprint" (same file) — the per-sector override map is a new definition field that must normalize server-side and fold into the definition fingerprint (a changed override clears the derived grade), like `source_symbol`.
- **PRESERVE** `@AC-7 @FR-6 @feature-205` "authored formula as component: identical inputs → identical output" (`docs/sdd/business-rules/platform.feature`) — a per-sector override is a pure input change, never a silent output alteration for identical resolved inputs.
- **EXTEND** `@AC-1..@AC-6 @feature-149` "manage_strategy rule serialization + update-mask discipline" (`services/xstockstrat-agent/acceptance/manage-strategy-accept-object-rules.feature`) — the new field rides the same mask rules; entry/exit-rule serialization untouched.

## Dependencies

- Proto/RPC: new closed `Sector` enum (`SECTOR_UNSPECIFIED=0`); new marketdata classification RPCs/messages (current + as-of); `StrategyDefinition` new field **15**; agent `backtest_view` allowlist + parity test if any `BacktestResult` field is added. All additive → `buf breaking` must pass.
- Migration: marketdata **007** (`symbol_classification` SCD-2). Per-sector params ride `analysis.strategies` JSONB → **no analysis migration**.
- Config keys: `marketdata.fmp.rate_limit_rps` (new; reconcile with existing `marketdata.fmp.daily_request_cap`), `marketdata.classification.refresh_cron`/`.enabled` (new namespace).
- Inter-service edges: analysis → marketdata (new as-of classification RPC, header trio); marketdata → FMP (gateway); marketdata → config (`GetSecret`).
- New env vars / ports: none (config keys, not env vars).

## Risks / Not-found

- **Compute-once vs per-bar (design crux).** `evaluator.py` computes each component's series once over the whole window with fixed `comp.params`; a per-bar sector-varying param cannot slot into the per-bar decision loop without segmenting the window by sector-validity intervals and computing per segment. Indicator warmup/lookback at a mid-window segment boundary is the hard part.
- **Chunk-lock regression (feature 153).** Per-bar as-of join over 400-day windows is the exact hot path that hit SQLSTATE 53200 — resolve sector intervals once per symbol per backtest, batched; size any sector hypertable chunk interval accordingly.
- **Default bucket must be a fixed default, not forward-fill** (feature 152 `@AC-3`) — bars predating any stored classification resolve to the configured default, never a carried-forward prior sector.
- **Byte-for-byte no-override parity** (features 151/149/152) — the segment-and-stitch path must collapse to exactly today's single compute when a strategy declares no overrides.
- **Proto-enum → shared-consumer coupling** (ledger `fails.md:81-82,1151`): the `Sector` enum + any strategy/backtest field hard-couples to the UI exhaustive `Record<Enum,…>` maps (`BacktestDiagnostics.tsx:17,25,31,40`) and the agent descriptor-parity test (`test_backtest_view.py:189`) in the same PR; also the six mcp-tool inventory surfaces.
- **Not found**: no marketdata `internal/testdata/` dir (tests use in-code pgxmock); no `Sector` enum / `symbol_classification` table / `marketdata.classification.*` keys / any sector concept anywhere — all net-new. No promoted `@AC-*` guards typed `FormulaParameter` (`input_params`) resolution today — 216's own acceptance.feature is its first guard. No promoted UI guarantee covers strategy authoring (feature 152 deferred the `source_symbol` editor) — the per-sector authoring UI is net-new.
- **Same-PR coupling (repo rule)**: a `run_backtest`/`manage_strategy` API change must update `plugins/strat-lab/skills/backtest/SKILL.md` in the same PR.

## Recommended Scope

Advisory step boundaries (Group A before Group B; one feature):
1. Proto: `Sector` enum + marketdata classification messages/RPCs (current + as-of) + `StrategyDefinition` field 15; `buf gen`.
2. marketdata migration 007: `symbol_classification` SCD-2 (+ as-of index, partial-unique on open row).
3. marketdata: centralized rate-limited FMP gateway (wrap `fmp.Client` with the Alpaca-style limiter; reconcile rps vs daily cap).
4. marketdata: classification refresh job (ticker template) — diff + version-on-change; + repo reads (current + as-of).
5. marketdata: classification RPCs wired through handler/service; tests (pgxmock + as-of cases).
6. analysis: per-sector param resolution — segment the backtest window by the symbol's sector-validity intervals, compute series per segment, default-bucket fallback, no-override byte-parity; batch the sector fetch (no per-bar RPC). Tests: mid-series reclassification (AC-7), default fallback (AC-8), parity.
7. agent: `manage_strategy` per-sector map arg + client mapping + merge-mask; update projections/parity; mcp-tools.md + six surfaces + strat-lab skill.
8. UI: per-sector override authoring in StrategyWizard/ComponentEditor + sector-resolved backtest display; fixtures; tokens; Playwright.
