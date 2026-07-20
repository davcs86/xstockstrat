# Recon: backtest-debug-info

**Created**: 2026-07-08
**From**: product-spec.md
**Affected services**: packages/proto, xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ui, xstockstrat-agent

---

## Objective

Surface full day-by-day backtest diagnostics (per-bar OHLCV, indicator/component series, warm-up
markers, signal scores, entry/exit/conviction decisions, and a per-symbol no-trade reason) so a
strategy author — and the MCP agent — can see *why* a backtest produced 0 trades on sufficient data.
Adds an Option-C declared-lookback warm-up (with a new custom-formula `warmup_period`) and caps all
backtests to 2 calendar years.

## Codebase Map

- **`packages/proto`**
  - `analysis/v1/analysis.proto:54` — `BacktestResult` (highest field `coverage_gaps = 13`; new
    `diagnostics` = **14**). `RunBacktestRequest.range` = field 2 (`:28`). Enums `BarAction` /
    `NoTradeReason` are net-new (must carry `_UNSPECIFIED = 0`, C-04).
  - `indicators/v1/indicators.proto:131/158/189` — `FormulaDefinition` (max field `11`),
    `RegisterFormulaRequest` (max `8`), `UpdateFormulaRequest` (max `8`) → `warmup_period` = **12 / 9 / 9**.
  - `marketdata/v1/marketdata.proto:44` — `Bar` OHLCV fields `open/high/low/close/volume/vwap/time`
    (timestamp field is **`time`**, field 2).
- **`xstockstrat-analysis`** (Python)
  - Servicer: `app/handlers/servicer.py:145` `RunBacktest`; config reads `:147-149`; result assembly
    `:292-304`; status `:308-311`.
  - Legacy SMA path `_backtest_symbol:341` — bar loop `:437`, `fast_values`/`slow_values` `:404-405`,
    `tech_signal` `:456`, `scoring.*` `:464-479`, entry `:481`, exit `:492`.
  - Definition path `_backtest_symbol_evaluated:550` — `evaluate()` call `:580`, bar loop `:589`.
  - Evaluator: `app/services/evaluator.py:74` `evaluate() -> list[BarDecision]`; `component_series`
    built local `:101-107`; `_INDICATOR_SERIES` `:30`; `BarDecision` `:45`.
  - Config accessor: `app/config/watcher.py:68` `get_int`.
  - Insufficient-data: `servicer.py:46` `_InsufficientData`, raised `:377` / `:577`, caught `:260-278`.
  - Scoring (pure): `app/services/scoring.py:10/45/63/68`.
  - Metrics: `servicer.py:975` `_compute_metrics`.
  - Tests: `tests/test_analysis_servicer.py:160` `TestRunBacktest`; `tests/test_analysis_helpers.py`.
- **`xstockstrat-indicators`** (Python)
  - Handlers: `app/handlers/servicer.py:197` `RegisterFormula`, `:258` `GetFormula`, `:272`
    `ListFormulas`, `:290` `UpdateFormula`, `:343` `_row_to_formula`.
  - Repo: `app/services/formulas_repository.py:57` `create`, `:77` `upsert`, `:158` `update`,
    `:16` `_to_dict` (all use `SELECT */RETURNING *` → new scalar column flows through automatically).
  - Validation: `app/services/parameters.py:81` `validate_outputs`, `:78` numeric `min>max` precedent.
  - Last migration: `003_formula_outputs.up.sql` (`ADD COLUMN outputs JSONB … DEFAULT '[]'`);
    scalar-column precedent `001_formulas.up.sql:9` (`is_public BOOLEAN NOT NULL DEFAULT FALSE`).
  - Seeding: `app/services/seed_formulas.py:35` `.upsert(...)`.
  - Tests: `tests/test_formulas.py:73` round-trip, `:211` stores-outputs; `tests/test_parameters.py`.
- **`xstockstrat-ui`** (Next.js)
  - Backtest + results: `src/app/insights/strategies/[id]/page.tsx` — form `:17-38`, date pickers
    `:162-176`, `handleRunBacktest` `:44-55`, results/`MetricCard` grid `:242-276`, equity curve
    `:279-314`, `INSUFFICIENT_DATA` card `:199-237`.
  - Formula form state (shared): `src/components/insights/FormulaWorkspace.tsx` — props `:46-68`,
    state `:95-104`, metadata markup `:209-238`, `onSave` payload `:188-198`. Pages
    `formulas/{new,[id]}/page.tsx` are thin wrappers.
  - Hooks: `src/hooks/useBacktest.ts:9` `useRunBacktest`; `src/hooks/useFormulas.ts:28/55`
    register/update. Clients: `browserClients/analysisClient.ts`, `browserClients/indicatorsClient.ts`.
  - Tests: `e2e/insights/backtest-coverage.spec.ts:12`, `e2e/insights/formulas.spec.ts`.
- **`xstockstrat-agent`** (Python MCP)
  - Tool: `app/tools.py:231` `run_backtest`. Client mapping: `app/client.py:138` (manual proto→dict,
    only 7 fields — drops trades/status/coverage_gaps). `MessageToDict` imported `:12`, used `:294+`.
  - Test: `tests/test_tools.py:231` (mocks `client.run_backtest` wholesale).

## Patterns to REUSE

- **Add `warmup_period` to formulas** → mirror the `outputs` column end-to-end (proto field → servicer
  read → repo `create`/`update`/`upsert` SQL → `_to_dict` → `_row_to_formula`), but as a **typed
  INTEGER column** like `is_public BOOLEAN` (`001_formulas.up.sql:9`), not JSONB.
- **Non-negative validation** → follow the `min > max` raise in `parameters.py:78`; servicer catches
  `ValueError` → `INVALID_ARGUMENT` (`servicer.py:222-226`).
- **Range-cap abort** → reuse the existing `context.abort(grpc.StatusCode.INVALID_ARGUMENT, …)` pattern
  at `analysis servicer.py:143/218`; read the int via `watcher.get_int` (`watcher.py:68`).
- **Day-by-day table** → reuse the shared shadcn `Table` set (`src/components/ui/table.tsx:54`), already
  used by `insights/formulas/page.tsx` — do **not** hand-roll a `<table>` (the screener page's
  raw-table at `screener/page.tsx:181` is the anti-pattern).
- **Formula input** → add the warm-up field inside `FormulaWorkspace.tsx` (single source of formula
  form state), threaded through `useFormulas` register/update payloads — not duplicated per page.
- **Agent projection** → switch `client.run_backtest` to the `MessageToDict(resp)` helper already used
  by sibling methods (`client.py:294+`) rather than hand-extending the manual 7-field dict.
- **Pure scoring reuse** → `scoring.compute_signal_score/combine_score/buy_threshold/sell_threshold`
  (`scoring.py`) are I/O-free; call them to fill a diagnostic row without re-deriving.

## Dependencies

- Proto/RPC: `analysis.proto` `BacktestResult += diagnostics=14` + new `BarDiagnostic` /
  `SymbolDiagnostics` messages + `BarAction` / `NoTradeReason` enums; `indicators.proto`
  `warmup_period` on `FormulaDefinition=12` / `RegisterFormulaRequest=9` / `UpdateFormulaRequest=9`.
  All additive. Run `./scripts/buf-gen.sh` (C-09).
- Migration: next number **`004`** for `services/xstockstrat-indicators/migrations/` (add
  `warmup_period INTEGER NOT NULL DEFAULT 0`; up+down).
- Config keys: `analysis.backtest.max_range_days` (int, default 730) — new; read via `get_int`.
- Inter-service edges: unchanged (agent → analysis `RunBacktest`; analysis → indicators `GetFormula`
  already exists for validation).
- New env vars / ports: none.

## Risks / Not-found

- **Evaluator return-type blast radius (primary design risk).** `evaluate()` returns
  `list[BarDecision]` and is consumed by the feature-048 live loop (`live_loop.py:119`, uses only
  `decisions[-1]`) and mocked as a list in `tests/test_strategy_evaluator.py` + `tests/test_live_loop.py`;
  the docstring (`evaluator.py:62`) pledges "feature 048 calls evaluate() directly with no signature
  changes." Exposing `component_series` must be **additive** (optional `return_series` kwarg or a second
  `evaluate_with_series` method) — a bare return-type change breaks the live loop + tests (P-03 risk).
- **Latent `bar.timestamp` vs `bar.time` bug.** Both loops read `bar.timestamp`
  (`servicer.py:489/499/530/601/608/637`) but the marketdata `Bar` proto field is **`time`**
  (`marketdata.proto:46`); tests pass only because bars are `MagicMock`. Diagnostics snapshot the bar
  timestamp, so the real attribute must be confirmed/fixed — otherwise the diagnostics timestamp (and
  possibly existing TradeRecord times) are wrong against real bars.
- **no_trade_reason must be a separate channel** from insufficient-data: insufficient symbols never
  enter the bar loop (raised `:377/:577`, become `CoverageGap` + `continue`), so their state stays
  "coverage gap" and must not be relabeled by per-bar no-trade logic.
- **UI table length / no virtualization.** `package.json` has no `react-window`/`@tanstack/*virtual`;
  ~504 rows/symbol is renderable but a multi-symbol run multiplies it — decide plain pagination vs a
  new dependency (recon leans pagination; no new dep).
- **Agent context size.** Including full `diagnostics` in the MCP tool response is the user's explicit
  choice (OQ-3 revised) — bounded by the 2-year cap; `MessageToDict` also restores the currently-dropped
  trades/status/coverage_gaps (a bonus, but grows the payload).
- **`_INDICATOR_WARMUP` exactness (OQ-5).** Per-indicator ±1 lookback constants must be pinned by a unit
  test against the indicators engine's real leading-gap output (grep found no existing warmup map).
- Ledger: `fails.md` / `insights.md` both empty — no prior trap or reusable pattern to fold in.

## Recommended Scope

Advisory step boundaries (input to grilling / /sdd-spec — the **split question** is live here):

1. **proto** — `analysis.proto` diagnostics messages/enums + `indicators.proto` `warmup_period`;
   `buf-gen`.
2. **indicators** — migration `004`, repo + servicer `warmup_period` plumbing, non-negative validation,
   tests.
3. **analysis** — additive evaluator `component_series` exposure; collect per-bar diagnostics in both
   paths; `_INDICATOR_WARMUP` map + Option-C warm-up length; no_trade_reason classifier; 2-year cap +
   config key; fix `bar.time`; tests.
4. **ui** — diagnostics `Table` on the strategy page + date-picker cap; `FormulaWorkspace` warm-up input;
   e2e.
5. **agent** — `MessageToDict` projection to include `diagnostics`; tool docstring; test.

Open question for grilling: whether the **custom-formula `warmup_period`** slice (proto + migration +
indicators + UI formula input) should split into its own dependency feature to keep each PR's review
surface tight, versus staying bundled.
