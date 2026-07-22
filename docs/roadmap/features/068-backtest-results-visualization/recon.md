# Recon: backtest-results-visualization

**Created**: 2026-07-21
**From**: product-spec.md
**Affected services**: `xstockstrat-analysis`, `xstockstrat-ui`, `packages/proto`

---

## Objective

Persist each `RunBacktest` run's full detail (trades, per-bar equity, diagnostics) so any row in
the Past Runs table can be reopened and visualized — metrics grid, time-based equity curve with
trade entry/exit markers, and per-bar diagnostics — via a new additive `GetBacktest(backtest_id)`
RPC. Retention is count-based: most recent 20 detailed runs per strategy (configurable).

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point / pool / config boot: `services/xstockstrat-analysis/app/main.py:41-49`
    (`ConfigWatcher(namespace="analysis")` + `wait_for_snapshot(90)`; asyncpg pool
    `max_size=DB_POOL_MAX or 2`); boot-hydrate precedent `hydrate_scores` at `app/main.py:88-92`
  - Servicer (RPCs + engine loops all here): `app/handlers/servicer.py`
    - `RunBacktest` entry `servicer.py:171-172` (uuid `backtest_id`); result built `:409-421`;
      status gate `:429-432`; diagnostics attached `:435-436`
    - In-memory latest stored under BOTH keys: `self._backtests[backtest_id]` **and**
      `self._backtests[request.strategy_id]` — `servicer.py:437-439` (dict declared `:95`)
    - Summary row persisted for ALL runs (OK + INSUFFICIENT) `servicer.py:472-478` →
      `_persist_backtest_run` `:1147-1180` (best-effort try/except → warning)
    - Per-symbol evidence cells OK-only `servicer.py:451-459` → `_persist_symbol_cells` `:1182-1214`
    - `GetStrategyReport` reads `self._backtests.get(strategy_id)` `servicer.py:1240-1244`
    - `ListBacktests` DB read, limit 0→20 `servicer.py:1247-1263`; row→proto `:1645`
    - **Per-bar equity exists but is discarded**: `_backtest_symbol` returns
      `(trades, equity, daily_equity, symbol_diag)` — seeded `:643`, appended each bar
      (`:653,662,737-738`, `portfolio_value = equity + position * price`), forced-close patch
      `:762-763`; same in `_backtest_symbol_evaluated` `:833-837,886,910-911`. Run-level
      `daily_equity.extend(daily_eq)` `:354` is a **sequential concatenation across symbols
      (not time-aligned)**; dropped after `_compute_metrics` `:1753-1779`
    - Diagnostics builders (shared by both engine paths): `_build_bar_diagnostic`
      `servicer.py:1471-1494` (no equity field), `_finalize_symbol_diagnostics` `:1516-1530`
    - Config read pattern: `self._cfg.get_int("analysis.backtest.max_range_days", 730)`
      `servicer.py:269`; typed getters `app/config/watcher.py:60-84`; **`get_int` zero-trap**
      (value `0` reads as default — service CLAUDE.md:212)
    - Header propagation per-method filter: `servicer.py:193-197` (x-user-id/x-access-scope/
      x-trace-id → outbound `metadata=`); admin bit check `_has_admin_scope` `:118-130`
  - Repos: `app/repositories/backtest_runs.py:25-77` (`insert` = `fetchrow` +
    `ON CONFLICT (backtest_id) DO NOTHING`; `list_by_strategy` ORDER BY completed_at DESC);
    batch pattern `app/repositories/backtest_run_symbols.py` (`insert_many`, feature 065);
    repo constructed only when pool given: `servicer.py:105`
  - Last migration: `007_backtest_run_symbols.up.sql` (`services/xstockstrat-analysis/migrations/`);
    006 created `analysis.backtest_runs` with comment "full trades/diagnostics intentionally NOT
    persisted" (`006_backtest_runs.up.sql:3`); index precedent `(strategy_id, completed_at DESC)`
  - Tests: `tests/test_backtest_runs_repo.py` (AsyncMock-pool, SQL+binds assertions),
    `tests/test_analysis_servicer.py` (`make_servicer()` `:25-33`, MagicMock cfg, repos None);
    coverage ≥40% (`.github/workflows/ci.yml:331,356-359`)

- **`xstockstrat-ui`** (Next.js)
  - Insights BFF: `src/lib/insightsBff.ts:27-59` (`router.service(AnalysisService, {...})`,
    `runBacktest`/`listBacktests` forwards at `:36-39`); dispatch `createDispatch(router,
    '/insights/api')` `:136`; canonical `forward` helper `src/lib/bffShared.ts:63-67`
  - Browser client: `src/lib/browserClients/analysisClient.ts:5-6` (`baseUrl: '/insights/api'`)
  - Hooks: `useStrategyReport` `src/hooks/useStrategies.ts:26-34` (key `['analysis-report', id]`,
    `enabled: !!id`, NOT_FOUND-aware retry); `useBacktestHistory` `:43-47`
    (key `['analysis-backtests', id]`); typing pattern `:5-7`; `useRunBacktest`
    `src/hooks/useBacktest.ts:9-17`
  - Strategy detail page: `src/app/insights/strategies/[id]/page.tsx`
    - result selection `:103` (`backtestResult ?? report?.latestBacktest`); pastRuns `:104`
    - equity curve derivation `:109-116` — cumulative `t.pnl` over trades, x = trade ordinal,
      **reads `form.initial_capital` (wrong for a historical run)**
    - chart `:364-398` (category-axis `LineChart`); Past Runs rows `:429-471` (non-interactive;
      legacy guard precedent `:441`); inline `isoToTimestamp` `:78-81`
  - Diagnostics component: `src/components/insights/BacktestDiagnostics.tsx:51`
    (props `{ diagnostics: SymbolDiagnostics[] }`, returns null when empty); exhaustive
    `Record<BarAction,string>` `:9-16` and `Record<NoTradeReason,string>` `:18-27` (C-10(d) trap)
  - Nav: `PlatformHeader.tsx:85-91` — detail page reached from `/insights/strategies` list
    (prefix match; in-page work needs no new nav entry)
  - E2E: `e2e/insights/backtest-coverage.spec.ts:67-105` (detail page + `past-runs` testid);
    mock backend `e2e/mock-backend.ts:396-398,442,529,554` (`AnalysisService` handlers;
    `listBacktests` fixture returns `bt-hist-2`/`bt-hist-1` for `strat-history-001`);
    auth helper `e2e/helpers/auth.ts:22`
  - Unit tests: `vitest.config.ts:8-28` (node env, coverage scoped `src/lib/**`, `all:false`,
    40%); only `src/lib/scoreDisplay.test.ts` exists — new derivation logic in `src/lib/` is
    unit-testable

- **`packages/proto`**
  - `analysis/v1/analysis.proto`: RPC list `:11-26` (no `GetBacktest`); `BacktestResult` `:56-71`
    highest field **14** (next free 15); `BarDiagnostic` `:106-121` highest **14**;
    `SymbolDiagnostics` `:124-130` highest **5**; `TradeRecord` `:73-82` highest **8** —
    `entry_time = 7` / `exit_time = 8` already carry marker timestamps;
    `BacktestRunSummary` `:164-182` highest **16**
  - Python stubs: `packages/proto/gen/python/analysis/v1/analysis_pb2*.py`; regen
    `./scripts/buf-gen.sh`

## Patterns to REUSE

- Detail persistence repo → mirror `app/repositories/backtest_runs.py` (asyncpg-pool wrapper,
  best-effort insert, `ON CONFLICT DO NOTHING`); reuse the **existing shared pool**
  (`app/main.py:47-49`) — no new pool (F-06)
- Best-effort persistence wrapper → `_persist_backtest_run` try/except→warning pattern
  (`servicer.py:1147-1180`); never fail the run on a persistence error
- In-memory-first read → `self._backtests` dual-key dict (`servicer.py:437-439`):
  `GetBacktest` checks memory by `backtest_id`, falls back to DB
- Per-row diagnostics assembly → `_build_bar_diagnostic` + `_finalize_symbol_diagnostics`
  (one builder both engine paths — insights ledger 2026-07-09)
- Config key read → `get_int` call-site default (`servicer.py:269`) + declare in service
  CLAUDE.md table (C-05); mind the zero-trap
- New BFF RPC → `forward()` registration in `insightsBff.ts:36-39` (no new plumbing)
- New query hook → copy `useBacktestHistory` shape (`useStrategies.ts:43-47`), NOT_FOUND-aware
  retry from `useStrategyReport` (`:26-34`)
- Historical/fresh single render path → existing `result` selection seam (`page.tsx:103`) —
  extend, don't fork, the results panel; `BacktestDiagnostics` reused as-is
- E2E → extend `mock-backend.ts` AnalysisService object with `getBacktest` keyed off
  `req.backtestId` (`bt-hist-2` → full result; `bt-hist-1` → NOT_FOUND legacy state);
  extend `backtest-coverage.spec.ts`
- Proto-Timestamp→Date conversion is inlined 7× across components (no shared helper) —
  consolidation candidate in `src/lib/` (DRY guard rail + unit-testable)

## Dependencies

- Proto/RPC: additive `rpc GetBacktest(GetBacktestRequest) returns (BacktestResult)`;
  `GetBacktestRequest { string backtest_id = 1 }` (new message). Candidate additive fields:
  `BacktestResult.initial_capital = 15` (needed to rebuild equity from trades — persisted
  nowhere today) and `BarDiagnostic.equity = 15` (per-bar portfolio value — computed in-engine,
  currently discarded). Field numbers verified free (`analysis.proto:56-71,106-121`)
- Migration: next number **`008`** for `services/xstockstrat-analysis/migrations/`
  (007 = `backtest_run_symbols`, on trunk baseline)
- Config keys: new `analysis.backtest.detail_retention_per_strategy` (int, default 20);
  existing `analysis.backtest.max_range_days` (730) bounds payload size
- Inter-service edges: UI insights BFF → analysis gRPC 50056 (existing edge, new method);
  no new service edges
- New env vars / ports: none

## Risks / Not-found

- **No per-bar equity anywhere today** — `BarDiagnostic` lacks it; `daily_eq` discarded after
  metrics. Time-based equity curve needs either a new proto field or client-side reconstruction.
- **`initial_capital` not persisted** — current UI curve reads local form state
  (`page.tsx:111`); a historical run cannot honestly rebuild equity without it.
- **Run-level `daily_equity` is a sequential per-symbol concatenation, NOT time-aligned**
  (`servicer.py:354`, symbols compound sequentially `:313,329`) — a run-level time-axis curve
  across symbols would be misleading; per-symbol curves are the honest time-aligned unit.
- **No retention/eviction precedent in analysis** (`strategy_scores`/`backtest_run_symbols`
  have "no pruning yet") — eviction logic is new code.
- **No time-axis/marker recharts usage in the repo** (`Scatter`/`ReferenceDot`/time scale
  absent) — chart work is new ground; keep it in one component.
- Ledger traps: C-10(b) parity `ListBacktests` ↔ `GetBacktest` (AC-4 test); C-10(d)-shorthand —
  if any proto enum is extended, update exhaustive TS `Record` maps in the same PR
  (`BacktestDiagnostics.tsx:9-27`); 2026-07-21 fails entry — **never round-trip NaN/Inf through
  protobuf Struct/JSON** (avoid JSON serialization of float payloads; serialized-proto bytes
  sidestep this).
- INSUFFICIENT_DATA runs get summary rows but will never have detail (FR-6 permanent state) —
  confirmed intentional at review; carry into design.

## Recommended Scope

1. `proto` — add `GetBacktest` RPC + request message; additive fields
   `BacktestResult.initial_capital = 15`, `BarDiagnostic.equity = 15`; buf-gen (paired
   frontend-build check per ledger trap).
2. `migration` — `008_backtest_details` (detail payload keyed `backtest_id`, index for eviction).
3. `service` (analysis) — capture per-bar equity into diagnostics + initial_capital into result;
   persist detail best-effort on OK runs; `GetBacktest` handler (memory → DB → NOT_FOUND);
   count-based eviction at insert; config key. Paired `test` step (≥40%).
4. `service` (ui) — BFF forward + hook; openable Past Runs rows; shared time-axis equity-curve
   component with trade markers used by fresh + historical views; legacy-row empty state.
   Paired e2e + unit tests.
5. `docs` — service CLAUDE.md config table, root CLAUDE.md recently-added keys, context.md.
