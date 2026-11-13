# Backtest Fill Model (feature 151)

> On-demand detail relocated from `CLAUDE.md` (context-forge just-in-time move). `RunBacktest` fill models (`SAME_BAR_CLOSE` legacy vs `NEXT_BAR_OPEN` bias-free) and the shared deferred-execution mechanics.

`RunBacktest` supports two fill models, selected by `RunBacktestRequest.fill_model` (else the
`analysis.backtest.default_fill_model` config key, else legacy):

- **`FILL_MODEL_SAME_BAR_CLOSE`** (legacy default) — a signal on bar `i` fills at bar `i`'s own
  close ± slippage. Optimistically biased (a mild look-ahead: the close that produced the signal is
  also the fill price).
- **`FILL_MODEL_NEXT_BAR_OPEN`** (opt-in, bias-free) — a signal on bar `i` fills at bar `(i+1)`'s
  open ± slippage. The standard bias-free convention.

Mechanics (both simulators share one deferred-execution state machine, `_apply_fill` over a
`SimState`; the loop stays the sole writer of `diags[...].action` and the sole appender to
`daily_equity`, so the feature-071 `daily_equity[j]↔diags[j]` 1:1 invariant is preserved):

- **Last-bar rule (no look-ahead):** a signal on the absolute last bar `n-1` schedules a fill for
  bar `n`, which never runs — so it opens no position and references no bar outside the window. A
  signal on `n-2` fills at `bars[n-1].open` then is force-closed at `bars[n-1].close` (one round
  trip), so trade counts stay symmetric across modes.
- **Cooldown is fill-to-fill:** the re-entry (feature 069) and exit/min-hold (feature 116) cooldowns
  are keyed on the **fill-bar** time. Byte-identical to legacy in same-bar mode (`signal == fill`).
- **Action/conviction decouple (display-only):** in next-bar mode a diagnostics row can show
  ENTER/EXIT on bar `i+1` while that row's `conviction` is bar `i+1`'s own value (the action reflects
  bar `i`'s signal). This is display-only — the derived grade math reads only
  sharpe/drawdown/win-rate, never conviction, so the grade is unaffected.

The effective model is recorded on `BacktestResult.fill_model`, `BacktestRunSummary.fill_model`, and
the `analysis.backtest_runs.fill_model` column (enum name), so a run is reproducible despite config
drift.
