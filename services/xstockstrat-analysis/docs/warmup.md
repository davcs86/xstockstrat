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
- **Backtest/live divergence (FR-7).** This is a *backtest-path* change; `live_loop.py` keeps its
  own 365-calendar-day window and no shortfall detection. The evaluator contract is unchanged —
  *same bar series ⇒ same decisions* still holds exactly — but the series each caller supplies now
  differs more than before for FIR indicators (and less, for EMA/MACD, thanks to the `3×`
  multiple). Pinned by `TestBacktestLiveParityUnchanged`; revisit this note before wiring the
  prefix into the live loop.
- Existing feature-065 evidence cells are **not invalidated** (OQ-3); they remain valid for the
  window they recorded, and the `trading_days` shift is immaterial against `k = 250` shrinkage.

**Data-coverage awareness** (feature 053): when a symbol has too few bars, `RunBacktest` no longer
fabricates a flat-equity "success". It returns a structured result with
`status = BACKTEST_STATUS_INSUFFICIENT_DATA` and per-symbol `coverage_gaps` (symbol, bars_have,
bars_need, the range to backfill) so the caller can surface a gap message and trigger a backfill.
`GetBars` is queried with the canonical `"1d"` timeframe (+ `timeframe_enum`), fixing the prior
`"1Day"` vs `"1d"` mismatch that made backfilled bars invisible to backtests.

