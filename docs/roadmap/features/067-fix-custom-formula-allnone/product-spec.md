# Product Spec: fix-custom-formula-allnone

**Type**: bug
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; bug captured directly via `/sdd-triage` (Track C)
**Severity**: SEV-2
**Created**: 2026-07-21

---

## Problem Statement

**Observed:** Strategies whose components use **custom formulas** (rather than builtin indicators)
produce **zero trades** in every backtest. Each affected symbol reports
`NO_TRADE_REASON_ENTRY_NEVER_TRUE`, and every per-bar diagnostic has an empty `"indicators": {}` map
with flat `signal_score`/`conviction` of `0.0`. The custom-formula component values never appear.

**Expected:** Custom-formula components should resolve to numeric per-bar values (present in the
diagnostics `indicators` map, like builtin `sma200` does), so entry/exit conditions can evaluate and
the strategy can open positions.

This is **not** a data-availability problem: builtin-indicator strategies on the same symbols and the
same freshly-backfilled OHLCV window trade normally. A trivial constant custom formula also returns
all-`None`, so the failure is upstream of any specific formula's logic.

## Reproduction Steps

On staging (paper), after backfilling AAPL daily bars from 2025-01-01 (~499 bars in the default
730-day window):

```
run_backtest(strategy_id="range_mean_reversion",   symbols=["AAPL"])
run_backtest(strategy_id="squeeze_breakout_trend", symbols=["AAPL"])
```

Both return `total_trades: 0`, `total_return/sharpe_ratio/max_drawdown: 0.0`,
`no_trade_reason: NO_TRADE_REASON_ENTRY_NEVER_TRUE`, `warmup_bars: 0`, `bars_total: 499`.

Representative diagnostic bar (note the empty `indicators`):

```json
{
  "symbol": "AAPL", "bar_index": 498,
  "close": 326.65, "action": "BAR_ACTION_HOLD_FLAT",
  "indicators": {},
  "warmup": false, "signal_score": 0.0, "conviction": 0.0
}
```

Contrast — a builtin-indicator strategy in the same session (`quality_dip_buyer`) shows
`"sma200": 224.91…` in later bars and takes 10 trades; `golden_cross_conviction` takes 16 trades.

## Root Cause Hypothesis

The custom-formula path runs through the evaluated backtest branch; custom formulas are executed via a
gRPC `ExecuteFormula` call, and two spots turn a failed / mis-shaped result into an all-`None` series
that the present-only diagnostics builder then filters out:

- `services/xstockstrat-analysis/app/services/evaluator.py:174` — `COMPONENT_KIND_CUSTOM_FORMULA` branch
- `services/xstockstrat-analysis/app/services/evaluator.py:182` — `await self._indicators.ExecuteFormula(...)`
- `services/xstockstrat-analysis/app/services/evaluator.py:190` — on `not resp.success`, silently returns `{"value": [None] * n}`
- `services/xstockstrat-analysis/app/services/evaluator.py:195-200` — decodes `resp.output` (a proto `Struct`);
  only outputs that pass `isinstance(raw, (list, tuple))` are kept, else `value` falls back to `[None] * n`
- `services/xstockstrat-analysis/app/handlers/servicer.py:690` — present-only comprehension drops all-`None` series → `{}`

**Leading hypothesis:** `resp.output` is a well-known-types `Struct` whose repeated values decode to
proto `ListValue`, **not** a Python `list`/`tuple`. If so, the `isinstance(raw, (list, tuple))` check at
`evaluator.py:197-200` skips every output and `value` defaults to all-`None`. To be verified against the
actual `xstockstrat-indicators` `ExecuteFormula` response shape during `/sdd-spec`.

## Affected Services

- `xstockstrat-analysis` (primary — evaluator decode/raise + backtest diagnostics surfacing)
- `xstockstrat-ui` (shared `BacktestDiagnostics.tsx` renderer — mandatory once the new enum value exists, else the frontend build breaks)
- `packages/proto` (new `NoTradeReason` enum value)
- `xstockstrat-indicators` (read-only reference — `ExecuteFormula` response shape; no code change)

## Fix Scope

- [ ] ~~No proto changes anticipated~~ → **Proto change required** (design Option A): append `NO_TRADE_REASON_FORMULA_ERROR` to the `NoTradeReason` enum (`analysis.proto`); non-breaking, run `buf-gen.sh`. See `design.md`.
- [x] No database migrations anticipated
- [x] No config key changes anticipated

(Updated by /sdd-design — the design debate chose Option A, which surfaces the failure as a visible `no_trade_reason`, requiring the proto enum + shared UI renderer update. See `design.md` and `context.md`.)

## Acceptance Criteria

- [ ] A custom-formula strategy component resolves to numeric per-bar values (non-`None`) and appears in the diagnostics `indicators` map
- [ ] `range_mean_reversion` and `squeeze_breakout_trend` no longer report `NO_TRADE_REASON_ENTRY_NEVER_TRUE` purely because component values are absent (they may still legitimately produce 0 trades if the entry condition is genuinely not met)
- [ ] A failed `ExecuteFormula` (`resp.success == false`) surfaces as a visible backtest error / `no_trade_reason` rather than silently degrading to all-`None`
- [ ] Regression test around `_compute_component` asserting a well-formed `ExecuteFormula` response yields a non-`None` series
- [ ] Existing tests pass
- [ ] `xstockstrat-analysis` smoke-tested on dev environment

## Out of Scope

- Refactoring unrelated to the bug
- Changes to the custom formula definitions themselves (z-score, efficiency ratio, squeeze percentile, trailing stop)
- Performance improvements unrelated to the fix
