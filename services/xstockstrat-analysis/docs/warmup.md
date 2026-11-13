# Pre-Window Warm-Up Prefix (feature 071) & Data-Coverage Awareness (feature 053)

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). Backtest-engine warm-up internals; load when working on the backtest path (`app/services/warmup.py`, `_fetch_bars_paged`).


When a `RunBacktest` request carries an **explicit `range.start`**, the engine fetches bars from
*before* that start so indicators are already warm at the first in-window bar, instead of burning
the caller's window on warm-up. The prefix length is **declared, never observed** — computed by
`app/services/warmup.py` from each referenced component's parameters. Observing it would be
provably wrong: `_ema`, `_macd` and `_vwap` emit no `None` head (`indicators_engine.py:48-51,62-84,110-118`),
so an observed warm-up is always `0` for exactly the path-dependent indicators a prefix matters
most for. EMA/MACD use a `3×` convergence multiple because `ewm(adjust=False)` is IIR — at `period`
bars the seed still carries ~13.5% of the weight.

- **Only on an explicit start.** `warmup_prefix=start_set` is snapshotted *before* the
  `max_range_days` defaulting block mutates `request.range` in place. A rolling-default run
  (no `start`) is byte-for-byte the pre-071 behavior.
- **Sizing-only conversion.** `prefix_calendar_days` converts bars→calendar days approximately;
  the engine then keeps **exactly** the required prefix (surplus discarded, deficit reported), so
  the conversion can only over-fetch or report — never quietly change a result.
- **Shortfall is fatal to the run** (OQ-1): too little history reports
  `BACKTEST_STATUS_INSUFFICIENT_DATA` with a `CoverageGap` spanning the **pre-window** range, not
  the requested window. No new `NoTradeReason` value.
- **VWAP anchor moves.** `_vwap` is an expanding average anchored at index 0, so its own lookback
  is `0` — but the prefix is the max over *all* referenced components. A strategy mixing VWAP with
  e.g. `SMA(50)` gets `P = 50` and every in-window VWAP value shifts. Deterministic, but different
  from an unprefixed run. Pinned by `TestVwapAnchorMovesWithPrefix`.
- **Formula warm-ups are prefetched before the symbol loop** (`_prefetch_formula_warmups`).
  `required_prefix_bars` reads the cache at the top of each symbol's run while
  `_compute_evaluated_warmup` fills it at the bottom, so a lazily-filled cache would give symbol 1
  no prefix and symbols 2+ the full one — making a result depend on symbol order.
- **`GetBars` is paged** (`_fetch_bars_paged`, `_MAX_BAR_PAGES = 32`). Analysis previously did not
  paginate while marketdata caps a page at 500 bars ASC, so **max-range backtests were silently
  dropping their newest bars**; correcting this shifts `trading_days` on long runs (≈0.8%).
  Exhausting the page cap **raises** rather than returning a truncated series.
- **Backtest/live divergence (FR-7), updated by feature 152.** For the **evaluated symbol** this is
  still a *backtest-path* change; `live_loop.py` keeps its own 365-calendar-day window and no
  shortfall detection for the evaluated symbol. **Feature 152 wires the warm-up prefix into the live
  loop for BENCHMARK (`source_symbol`) components only**: `live_loop._load_benchmark_bars` sizes each
  benchmark's fetch with `warmup.required_prefix_bars` (builtins via `builtin_lookback_bars`, custom
  formulas via the declared `warmup_period` fetched by `StrategyEvaluator.declared_formula_warmups`)
  and widens that benchmark's `GetBars` window by `prefix_calendar_days(...)` beyond `_LOOKBACK_DAYS`,
  so a benchmark gate is actually warm on the live path (a missing/under-warmed benchmark degrades to
  a gap → hold, never a crash). The evaluator contract is still unchanged — *same bar series ⇒ same
  decisions* holds exactly. Pinned by `TestBacktestLiveParityUnchanged` (evaluated-symbol lookback
  stays 365) and `test_live_source_symbol.py` (benchmark warmup widening).
- Existing feature-065 evidence cells are **not invalidated** (OQ-3); they remain valid for the
  window they recorded, and the `trading_days` shift is immaterial against `k = 250` shrinkage.

**Data-coverage awareness** (feature 053): when a symbol has too few bars, `RunBacktest` no longer
fabricates a flat-equity "success". It returns a structured result with
`status = BACKTEST_STATUS_INSUFFICIENT_DATA` and per-symbol `coverage_gaps` (symbol, bars_have,
bars_need, the range to backfill) so the caller can surface a gap message and trigger a backfill.
`GetBars` is queried with the canonical `"1d"` timeframe (+ `timeframe_enum`), fixing the prior
`"1Day"` vs `"1d"` mismatch that made backfilled bars invisible to backtests.

## Benchmark / reference-symbol operand (`source_symbol`, feature 152)

A `StrategyComponent` carries an optional **`source_symbol`** (`analysis.proto` field 6). When
non-empty, the component's indicator/formula is computed on **that** symbol's bars (e.g. `VOO`) and
its output series is **left-joined onto the evaluated symbol's trading-day (date) timeline**; empty =
computed on the evaluated symbol (byte-identical to pre-152, and — being a plain proto3 string — an
unset value is omitted from `definition_json` so the definition fingerprint is unchanged). This
enables cross-symbol "market-regime" gates (buy dips on any symbol only when `VOO`'s 200-day is
rising) that per-symbol operands cannot express.

- **One computation unit.** `StrategyEvaluator._assemble_component_series(comp, closes, eval_dates,
  benchmark_bars)` is the single seam behind every StrategyComponent consumer — backtest
  (`evaluate_with_series`), live (`evaluate`), readiness/opportunities (`evaluate_conditions_traced`),
  and `GetIndicatorSeries`. A `source_symbol` component with no benchmark bars supplied → all-`None`
  (safe hold), **never** computed on the evaluated closes.
- **Compute-then-align, no look-ahead.** The indicator/formula runs on the benchmark's own contiguous
  closes first, *then* the output is date-joined (`bar.time.ToDatetime(UTC).date()`); a date the
  benchmark lacks → `None` (leaf reads hold/false) — no forward-fill, the evaluated symbol is never
  reindexed, and a benchmark value at bar *t* uses only benchmark data ≤ *t*.
- **Warmup / coverage.** Benchmark bars are loaded window+warmup like the evaluated symbol
  (`_load_benchmark_bars`, deduped once per backtest run); a benchmark warmup shortfall raises
  `_InsufficientData(source_symbol)` → a `CoverageGap` naming the **benchmark**, and the run reports
  `BACKTEST_STATUS_INSUFFICIENT_DATA`. The **live loop** wires this too
  (`live_loop._load_benchmark_bars`, builtin lookback + declared formula `warmup_period` via
  `StrategyEvaluator.declared_formula_warmups`); the opportunities pass dedups each benchmark to one
  fetch under `_readiness_materializer_bars_sem` (feature 185).
- **Write path.** `ManageStrategy` normalizes `source_symbol` server-side (uppercase/trim, empty →
  unset) on both REGISTER and UPDATE (`_normalize_source_symbols`); it enters the fingerprint via
  `definition_json`, so changing a benchmark clears the derived grade.
- **Deferred:** `screen_symbols` `source_symbol` and a UI strategy-builder editor for it are follow-ons
  (agent-authored strategies are fully functional now via `manage_strategy`).
