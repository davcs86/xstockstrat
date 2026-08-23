# Recon: backtest-portfolio-sizing

**Created**: 2026-08-23
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (engine); consumer surfaces xstockstrat-agent (`run_backtest`), xstockstrat-ui (`/insights` backtest views)

---

## Objective

Replace the backtest engine's serial per-symbol equity compounding — where one running `equity`
scalar is threaded symbol→symbol and per-symbol curves are concatenated, making aggregate
`total_return` a Π(1+rᵢ)−1 parlay — with an **opt-in, versioned** portfolio model: a shared capital
pool, concurrent positions, one portfolio equity curve. Aggregate metrics become order-independent and
interpretable, while legacy runs and the feature-065 grade are preserved.

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - RunBacktest handler / per-symbol loop: `app/handlers/servicer.py:381` (handler), seed + serial
    threading `:501-503,522,525,529,540,546`, per-symbol curve concatenation `:570-571`, aggregate
    metrics `:624-626`.
  - Simulators: `_backtest_symbol` (SMA) `:845`; `_backtest_symbol_evaluated` (definition) `:1080`.
    Both size at 95% of `equity` (`:1005-1013`, `:1190-1198`), mark-to-market append
    (`:1047-1048`, `:1235`), forced close at last bar (`:1051-1073`, `:1238-1260`).
  - `_compute_metrics`: `:3617`; `total_return` `:3648`, `max_drawdown` `:3662-3664`, `sharpe`
    `:3657-3659`. Per-symbol evidence-cell call `:558`, cell fields `:559-569`
    (`sharpe/max_drawdown/win_rate/total_return/total_trades/trading_days`).
  - Feature-065 grade: `_score_from_metrics` `:3310-3336` (blends **only** sharpe/max_drawdown/
    win_rate), `_grade` `:3339-3349`, `_score_from_result` `:3394-3419`, per-run grade call
    `:695-701`.
  - Persistence: `_persist_backtest_run` `:1546-1579` → `BacktestRunsRepository.insert`
    `app/repositories/backtest_runs.py:25-68` → table `migrations/006_backtest_runs.up.sql:5-21`
    (+ `range_start/range_end/n_symbols` in 007, `user_id` in 015). Per-symbol cells table
    `backtest_run_symbols` `migrations/007_backtest_run_symbols.up.sql:8-23`. Detail bytes
    `migrations/008_backtest_details.up.sql`. **Latest migration: `016_order_snapshots_pnl_patterns`
    → next is `017`.**
  - Config reads (`analysis.backtest.*`): commission/slippage `get_float` `:383-384`, `max_range_days`
    `get_int` `:477`; zero-trap helpers in `app/config/watcher.py:95-143` (`get_int` zero-traps;
    `get_int_present`/`get_float_present` use `HasField`).
  - Bars fetch: per-symbol independent `_resolve_prefixed_bars`→`_fetch_bars_paged`
    (`:749,772-781`, called `:869,1103`). **No shared time index across symbols.**
- **`xstockstrat-agent`** (Python) — tool `run_backtest` `app/tools.py:456`; gRPC request builder
  `app/client.py:503,534-551`; summary/attachment projection `app/backtest_view.py` (metric keys
  `:38-47`). Sole consumer of `BacktestResult`.
- **`xstockstrat-ui`** (Next.js) — backtest surface `src/app/insights/strategies/[id]/page.tsx`
  (metrics grid `:508-543`, Past Runs `:557-582`, columns `:124-194`); BFF forwards `runBacktest`/
  `getBacktest` unchanged `src/lib/insightsBff.ts:35,40`; typed shape `src/hooks/useBacktest.ts:7`.
- **Proto** — `packages/proto/analysis/v1/analysis.proto`: `RunBacktestRequest` `:52-62` (**next field
  = 8**), `BacktestResult` `:84-107` (**next field = 17**; renumber warning `:80-83`),
  `BacktestRunSummary` `:203` (**next field = 17**).

## Patterns to REUSE

- **Opt-in additive enum with `_UNSPECIFIED=0` default** → follow proto governance C-04 and the
  existing enum shape (`BacktestStatus` `analysis.proto:64`); a `SizingMode` enum on
  `RunBacktestRequest` field 8, `..._UNSPECIFIED`→legacy, keeps `buf breaking` green.
- **Metric computation** → reuse `_compute_metrics` (`servicer.py:3617`) for the portfolio curve;
  do not fork a second metrics function (DRY). Portfolio mode just feeds it a different curve.
- **Per-symbol evidence cells** → keep the `_compute_metrics(daily_eq, …)` cell call `:558` and
  `backtest_run_symbols` write **unchanged** so the derived grade stays identical (FR-4).
- **Config zero-trap discipline** → any new default (e.g. max-weight) uses `get_float`/`get_int`
  with the correct present-variant per `watcher.py:95-143`.
- **Agent request threading** → add the optional field beside the existing `range` threading at
  `client.py:544-551`; surface the mode in `backtest_view.py` `_METRIC_KEYS`/`_HEAD_KEYS`.
- **UI mode label** → add a `MetricCard`/badge from `result.mode` in `strategies/[id]/page.tsx:511-545`;
  no BFF change (forwards full message).
- **E2E fixtures** → extend `e2e/fixtures/backtests.ts` + `INVENTORY.md`; mock-backend branches in
  `e2e/mock-backend.ts` (C-12/C-13).

## Existing Business Rules (preserve / extend)

- **No existing acceptance suite for `xstockstrat-analysis` yet** — nothing promoted guards
  `total_return`/`max_drawdown`/`sharpe` semantics, fill timing, no-look-ahead, derived-grade/scoring
  determinism, or reproducibility. This feature must **author** those guarantees in its
  `acceptance.feature` (they promote at launch, C-16); they are not inherited.
- **No existing acceptance suite for `xstockstrat-ui` yet** — `/insights` backtest views have no
  promoted `@AC-*`.
- **`xstockstrat-agent`** suite exists but carries no backtest guarantee (only `@AC-9` OAuth txn,
  unrelated). Nothing to preserve.
- **`platform.feature`** — no cross-cutting rule this feature's subject touches.
- Note (scenario-recon): because "portfolio mode" is **opt-in** and no promoted rule pins the
  serial-compounding numbers, this is not a silent C-16 regression. **But** if the design ever makes
  portfolio-mode the default or alters serial-mode output, that needs explicit user sign-off in
  `context.md` under the general C-16 principle.

## Dependencies

- Proto/RPC: additive `SizingMode` enum + `RunBacktestRequest.sizing_mode = 8`; a mode marker on
  `BacktestResult = 17` and `BacktestRunSummary = 17`. Additive only — `buf lint`/`buf breaking` (C-09).
- Migration: next number `017` for `services/xstockstrat-analysis/migrations/` — a nullable
  `sizing_mode` column on `analysis.backtest_runs` (additive; F-01 forbids editing applied migrations).
- Config keys: possible `analysis.backtest.portfolio_max_weight` / `.portfolio_max_concurrent`
  (defaults declared in the service CLAUDE.md; F-07 no hardcoding). Decide request-param vs config in design.
- Inter-service edges: none new (marketdata `GetBars` already used).
- New env vars/ports: none.

## Risks / Not-found

- **No shared calendar across symbols** (`servicer.py:749,772-781`) — each symbol is fetched
  independently with its own bar count (observed 230–251 bars for the 33-symbol cohort). A true
  portfolio equity curve requires marking all open positions on a **common time axis**; the engine has
  none today. This is the central design problem: union the per-symbol date indices, forward-fill last
  known close for symbols missing a bar on a given date, and iterate one shared timeline. Risk of
  look-ahead / misalignment if done naively.
- **`daily_equity[j]` ↔ `diags[j]` 1:1 invariant** (assert `servicer.py:3275-3296`, feature 071) — the
  per-symbol diagnostics are stamped from the per-symbol curve. A portfolio curve is
  portfolio-level, not per-symbol, so the design must decide how per-symbol `BarDiagnostic.equity`
  (proto field 15) is populated in portfolio mode without breaking the assert.
- **Concurrent-capital accounting** — allocation policy, max concurrent positions, and the
  insufficient-capital skip (FR-5) are unspecified; must be pinned in design (see Open Questions).
- **Backtest/live parity** — the live loop places no orders, so portfolio sizing is a backtest-only
  accounting concern; confirm no parity claim is broken.
- Ledger trap **067**: a new proto enum couples to UI exhaustive `Record<…>` maps
  (`BacktestDiagnostics.tsx:10-27`) — a `SizingMode` enum surfaced in the UI needs its TS map key in
  the same PR or `tsc`/`pnpm build` fails.
- Root CLAUDE.md: a `run_backtest` change must update the `strat-lab` `backtest` skill in the **same
  PR** (`plugins/strat-lab/skills/backtest/SKILL.md:15-18,94-100`, `reference/output-handling.md:11-19`).

## Recommended Scope

Advisory step boundaries for `/sdd-spec` (not binding):
1. Proto: add `SizingMode` enum + `RunBacktestRequest.sizing_mode`; mode marker on result/summary; `buf` gen.
2. Engine: shared-calendar builder + portfolio execution path (shared pool, concurrent positions,
   allocation policy, insufficient-capital skip); route `RunBacktest` by `sizing_mode`, legacy default.
3. Metrics: feed the portfolio curve into `_compute_metrics`; keep per-symbol cells + grade unchanged.
4. Persistence: migration 017 `sizing_mode` column; write it in `_persist_backtest_run`.
5. Agent: optional `sizing_mode` arg on `run_backtest`; surface mode in the summary; update strat-lab skill.
6. UI: label the mode on the strategy-detail results + optional Past Runs column; fixtures + tests.
