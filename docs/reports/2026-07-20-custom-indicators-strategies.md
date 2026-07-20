# Registered Custom Indicators & Strategies — 2026-07-20

Catalog of five custom formula indicators and five strategy definitions registered on **staging**
via the MCP agent tools (`manage_formula` / `manage_strategy`), plus two platform bugs uncovered
while validating them with `run_backtest`. GitHub issues are disabled on the repository, so the
bug reports live here until they are routed through `/sdd-triage`.

All formulas are **close-only** by design: the strategy evaluator feeds custom-formula components
only `data["close"]` (`services/xstockstrat-analysis/app/services/evaluator.py`,
`_compute_component`), so indicators requiring high/low/volume (ADX, SuperTrend, TTM Squeeze, CMF)
were adapted to close-only equivalents. All formulas return **full-length series** aligned to the
input bars, with `None` for warm-up rows, and expose their rule operand as the primary `value`
series (the MCP `manage_formula` tool cannot declare `outputs`, so dotted
`<ref>.<series>` references are unavailable for MCP-registered formulas).

## Formulas (staging `indicators.formulas`)

| Name | `formula_id` | Params (defaults) | value series |
|---|---|---|---|
| Mean-Reversion Z-Score | `127e7b0d-ab8e-461a-af7b-da3bb9739204` | `period=20` | (close − rolling mean) / rolling std |
| Kaufman Efficiency Ratio | `60c5b411-a7b7-4b5c-beb5-fdcb12ec83d1` | `period=10` | net move / path length, 0..1 trend-strength regime filter |
| Volatility Trailing Stop Direction | `7f595658-2a7f-4ddb-a83a-5fc3d625472d` | `period=22`, `multiplier=3.0` | ±1 Chandelier-style ratcheting stop direction (close-change volatility proxy); extra `stop_line` series |
| Bollinger Squeeze Percentile | `31bb8ea6-0f3e-4cf7-8844-ec8294cebf85` | `period=20`, `lookback=120` | percentile rank (0..1) of BB bandwidth — low = volatility compression; extra `bandwidth` series |
| Momentum Quality (Clenow) | `67139be6-27ff-4e03-b57f-a5398e7ea9a6` | `period=90` | annualized log-close regression slope × R² |

All are `is_public=true`, author `davcs86`. Each was verified locally through the real sandbox
(`app/services/sandbox.py`) with the exact per-component params the strategies supply
(500 synthetic bars: all `success=true`, 100–290 ms, well inside the 5000 ms / 128 MiB limits).

## Strategies (staging `xstockstrat-analysis`)

| `strategy_id` | Components | Entry | Exit | Signal params |
|---|---|---|---|---|
| `squeeze_breakout_trend` | `sqz` (Squeeze Pctile), `macd` (MACD 12/26/9), `vts` (Trailing Stop) | `sqz crosses_above 0.25 AND macd.histogram > 0` | `vts crosses_below 0` | — |
| `golden_cross_conviction` | `sma_fast` (SMA 20), `sma_slow` (SMA 50) | fast crosses_above slow | fast crosses_below slow | `unusual_whales`, signal 0.3 / technical 0.7, min_conviction 0.6 |
| `quality_dip_buyer` | `rsi` (RSI 14), `px` (SMA 1 close proxy), `sma200` (SMA 200) | `rsi < 35 AND px > sma200` | `rsi > 60` | — (universe pre-filtered via screener fundamental composite ≥ 0.7) |
| `range_mean_reversion` | `z` (Z-Score 20), `er` (Efficiency Ratio 10) | `z < -2 AND er < 0.15` | `z crosses_above 0` | — |
| `fundamentals_macd_blend` | `macd` (MACD 12/26/9) | `macd crosses_above macd.signal` | `macd crosses_below macd.signal` | `fundamentals` (feature 062 derived source), signal 0.4 / technical 0.6, min_conviction 0.5 |

The two signal-weighted strategies work standalone today (technical weight ≥ min_conviction, so
zero signal contribution still allows entries) and pick up signal boost automatically once their
sources exist. **Staging currently has no registered signal sources** (`list_signal_sources → []`);
`unusual_whales` needs registration via `manage_signal_source`, and `fundamentals` self-registers
when `analysis.fundsignal.enabled` is flipped on.

## Bug 1 — evaluator misaligns built-in indicator series (code bug, reproducible from source)

> **Status: FIXED in this PR.** `align_indicator_points` (`app/services/evaluator.py`) tail-aligns
> `ComputeIndicator` results onto the input bars (`offset = n - len(result)`), and both consumers —
> the definition-based evaluator and the legacy SMA-crossover path in `servicer.py` — now use it.
> The screener needs no change (it only reads the latest value). Regression tests cover shortened,
> full-length, and empty results plus extras alignment. The description below is kept for the record.

`ComputeIndicator` (`services/xstockstrat-indicators/app/handlers/servicer.py`) **drops warm-up
points** (`if r.get("value") is None: continue`) even though `indicators_engine._sma`/`_rsi`/… return
full-length series with a `None` head. The evaluator (`_compute_component`,
`services/xstockstrat-analysis/app/services/evaluator.py`) then **head-aligns** the shortened result
(`for i, p in enumerate(resp.result): series["value"][i] = p.value`), assuming it is full-length.

Net effect: every warm-up indicator series is shifted left by its own warm-up length, and components
with different periods are shifted by **different** offsets — `sma_fast crosses_above sma_slow`
compares 20-bar and 50-bar windows ending ~30 bars apart. EMA/MACD (no NaN head) are unshifted,
making mixed rules internally inconsistent. This corrupts `RunBacktest`, the feature-048 live loop
(shared evaluator), and feature-064 diagnostics/warm-up computation.

Evidence (staging backtest `dd8c60c4-45df-4efd-91d5-2434da0c3b54`, `golden_cross_conviction` on
AAPL, 113 bars 2024-07-22 → 2024-12-30, a range containing AAPL's real September-2024 golden cross):
`total_trades=0`, `NO_TRADE_REASON_ENTRY_NEVER_TRUE`; diagnostics show `sma_slow: 220.5456` already
at bar 0 (a 50-bar average belonging to bar 49) and empty `indicators` on the final 49 bars.

Fix directions: add per-point index / warm-up count to `ComputeIndicatorResponse` (proto change), or
stop dropping `None` rows, or minimally tail-align in the evaluator
(`offset = len(closes) - len(resp.result)`) — valid while warm-up gaps are only a contiguous head.

## Bug 2 — custom formula execution yields no series via the strategy engine (staging-only, cause unconfirmed)

Every `COMPONENT_KIND_CUSTOM_FORMULA` component evaluates to all-`None` on staging — including a
diagnostic constant formula with **no imports and no params** (`result = {"value": [1.0 for _ in
data["close"]]}`), registered and exercised through a throwaway probe strategy (since deactivated;
probe formulas deleted). Diagnostics show `"indicators": {}` at every bar for formula components
while built-in components on the same run produce values.

Ruled out: formula source (all five run in the real sandbox locally), parameter typing (int params
accept integral floats in `parameters.py::_coerce`), MCP parameter mapping
(`services/xstockstrat-agent/app/client.py` maps correctly), and code drift (deployed tag `611f37f`
has an identical evaluator, indicators servicer, and sandbox). Since a formula-not-found or RPC
error would abort the backtest rather than return `BACKTEST_STATUS_OK`, the indicators service must
be returning `success=false` (or empty output) for every sandboxed run from this path. Prime
suspect: the sandbox subprocess itself failing in the DO App Platform (gVisor) runtime — e.g.
`resource.setrlimit(RLIMIT_DATA, …)` or subprocess spawn behavior — but DO's log proxy returned no
data, so the actual `exit_reason`/stderr is unconfirmed. Next step: read the
`indicators.formula.executed` ledger events or the indicators RUN logs for the failing runs.

## Operational follow-ups

1. **Backfill staging OHLCV** — bars end 2024-12-30 (113 bars in the default 730-day window), so
   `sma200` never resolves and long-lookback strategies can't evaluate
   (`docs/runbooks/historical-backfill.md`).
2. Register the `unusual_whales` signal source and enable `analysis.fundsignal.enabled` to activate
   the signal-weighted halves of `golden_cross_conviction` / `fundamentals_macd_blend`.
3. Bug 1 is fixed in this PR. Bug 2 still needs staging log access (read the
   `indicators.formula.executed` ledger events or the indicators RUN logs) before it can be routed.
   Re-run the five backtests after the Bug 2 fix lands and this PR deploys.
