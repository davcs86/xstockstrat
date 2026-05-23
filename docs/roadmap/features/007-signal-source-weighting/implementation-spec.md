# Implementation Spec: signal-source-weighting

**Status**: `pending`
**Created**: 2026-05-23
**Feature**: `docs/roadmap/features/007-signal-source-weighting/feature.md`
**Total Steps**: 4
**Feature Branch**: `feature/signal-source-weighting`

---

## Execution Summary

The feature touches two services: `xstockstrat-config` (seed new config key) and `xstockstrat-analysis`
(read the key and apply per-source multipliers in `_compute_signal_score`). No proto changes are
required. The config migration must land first so the key is present when the analysis service reads
it at startup. Step 1 seeds the new config key via a new migration in `xstockstrat-config`.
Step 2 adds the weight-lookup and clamping logic to `_compute_signal_score` in `xstockstrat-analysis`.
Step 3 updates the analysis service's `CLAUDE.md` to document the new key (FR-6, AC-5). Step 4 adds
unit tests for the weighted scoring logic.

## Step Dependencies

- Step 2 requires Step 1: the analysis service reads `analysis.signals.source_weights` at startup;
  the config migration must be present so the key is available in the config store.
- Step 3 requires Step 2: docs must reflect the final implementation, not a draft.
- Step 4 requires Step 2: tests exercise the new logic introduced in Step 2.

---

### Step 1 — config: Seed `analysis.signals.source_weights` config key

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/003_analysis_signal_source_weights.up.sql` — create
- `services/xstockstrat-config/migrations/003_analysis_signal_source_weights.down.sql` — create

**Reviewers**: `xstockstrat-config` owner — Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last migration file confirmed via `ls services/xstockstrat-config/migrations/ | sort` → `002_config_environment.up.sql`; next NNN is `003`
- Seed INSERT pattern confirmed in `services/xstockstrat-config/migrations/002_config_environment.up.sql:L46` — uses `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)` columns with `ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING`
- `value_type` column supports `'string'` for JSON payloads; `buildConfigValue` at `services/xstockstrat-config/src/grpc/configServiceImpl.ts:L248` returns `{ string_val: row.value_data }` for `'string'` type — JSON is stored as a string blob
- Existing analysis config keys seeded in `migrations/001_config_tables.up.sql:L69` (`analysis.backtest.max_duration_seconds`) and `migrations/002_config_environment.up.sql:L71` (production variant); same pattern applies here

**Instructions**:

Create `services/xstockstrat-config/migrations/003_analysis_signal_source_weights.up.sql`:

```sql
-- Migration: 003_analysis_signal_source_weights.up.sql
-- Service: xstockstrat-config
-- Adds analysis.signals.source_weights config key (JSON string, per-source conviction multiplier)

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('analysis', 'signals.source_weights', 'string', '{}',
   'JSON object mapping signal source name to reliability weight in [0.0, 1.0]. Empty object means all sources use weight 1.0 (neutral).',
   '{}', 'xstockstrat-analysis', 'dev', 'all'),
  ('analysis', 'signals.source_weights', 'string', '{}',
   'JSON object mapping signal source name to reliability weight in [0.0, 1.0]. Empty object means all sources use weight 1.0 (neutral).',
   '{}', 'xstockstrat-analysis', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
```

Create `services/xstockstrat-config/migrations/003_analysis_signal_source_weights.down.sql`:

```sql
-- Migration: 003_analysis_signal_source_weights.down.sql
-- Removes analysis.signals.source_weights config key

DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND key = 'signals.source_weights';
```

**Verification**:
```bash
# Confirm migration files exist and are correctly numbered
ls services/xstockstrat-config/migrations/ | sort
# Expected: 001_config_tables.up.sql, 001_config_tables.down.sql,
#           002_config_environment.up.sql, 002_config_environment.down.sql,
#           003_analysis_signal_source_weights.up.sql, 003_analysis_signal_source_weights.down.sql

# Confirm up/down pair are present
ls services/xstockstrat-config/migrations/003_analysis_signal_source_weights.{up,down}.sql
```

---

### Step 2 — service: Apply per-source weight multiplier in `_compute_signal_score`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_compute_signal_score` at `services/xstockstrat-analysis/app/handlers/servicer.py:L494` — module-level function, signature `(signals_map: dict, bar, signal_sources: list) -> float`; currently accumulates `buy_conviction` and `sell_conviction` without any per-source multiplier (lines 504–517)
- Config is read via `self._cfg.get_str(key, default)` (confirmed pattern at `services/xstockstrat-analysis/app/config/watcher.py:L60`); `get_float` called at `servicer.py:L50` shows the `self._cfg.get_float(...)` access pattern
- `RunBacktest` calls `_compute_signal_score` at `servicer.py:L297` — `signal_score = _compute_signal_score(signals_map, bar, signal_sources)` — no `source_weights` argument today
- `self._cfg` is the `ConfigWatcher` instance stored on `AnalysisServicer.__init__` at `servicer.py:L40` — it is accessible inside `RunBacktest` and `_backtest_symbol`
- `_backtest_symbol` is called from `RunBacktest` at `servicer.py:L107`; receives `signal_sources` as a parameter (line 115); does not yet receive `source_weights`
- `analysis.signals.source_weights` key: confirmed absent from all existing code and migration files via `grep -rn "source_weights" services/` → only hit is `xstockstrat-config-ui/app/sources/page.tsx:L164` (config-ui UI reference, confirming the key name is correct)
- `get_str` returns a `string_val` or the default string; JSON parsing via `json.loads()` follows the same pattern as inline config parsing in other Python services
- FR-5 clamping: weight values must be clamped to `[0.0, 1.0]` at read time using `max(0.0, min(1.0, w))`
- FR-3 default: if source is absent from the weights map, effective multiplier is `1.0`

**Instructions**:

1. **Add `source_weights` to `_compute_signal_score` signature and logic**

   Modify `_compute_signal_score` at `services/xstockstrat-analysis/app/handlers/servicer.py:L494`:

   Change the function signature from:
   ```python
   def _compute_signal_score(signals_map: dict, bar, signal_sources: list) -> float:
   ```
   to:
   ```python
   def _compute_signal_score(signals_map: dict, bar, signal_sources: list, source_weights: dict | None = None) -> float:
   ```

   Inside the `for source in signal_sources:` loop (currently at L504), retrieve the clamped weight for each source before accumulating conviction. Replace the loop body at lines 504–517:

   ```python
   for source in signal_sources:
       weight = max(0.0, min(1.0, (source_weights or {}).get(source, 1.0)))
       for sig in signals_map.get(source, []):
           valid_from = sig.valid_from.ToDatetime() if sig.valid_from.seconds > 0 else None
           valid_until = sig.valid_until.ToDatetime() if sig.valid_until.seconds > 0 else None
           if valid_from and bar_ts < valid_from:
               continue
           if valid_until and bar_ts > valid_until:
               continue
           conviction = sig.conviction if sig.conviction > 0 else 0.5
           if sig.direction == "buy":
               buy_conviction += conviction * weight
           elif sig.direction == "sell":
               sell_conviction += conviction * weight
           count += 1
   ```

   The `net = (buy_conviction - sell_conviction) / count` normalization at line 521 and the `return (net + 1.0) / 2.0` at line 523 remain unchanged — the result stays in `[0.0, 1.0]` because conviction is non-negative and weight is in `[0.0, 1.0]`.

2. **Read `analysis.signals.source_weights` from config in `RunBacktest`**

   In `RunBacktest` at `servicer.py:L48`, after the existing `commission` and `slippage` reads (lines 50–51), add:

   ```python
   _weights_raw = self._cfg.get_str("analysis.signals.source_weights", default="{}")
   try:
       source_weights = {
           k: max(0.0, min(1.0, float(v)))
           for k, v in json.loads(_weights_raw).items()
       } if _weights_raw else {}
   except (ValueError, TypeError):
       log.warning("analysis.signals.source_weights is not valid JSON — using empty weights")
       source_weights = {}
   ```

   Add `import json` to the module-level imports at the top of the file (alongside the existing `import logging`, `import math`, etc.).

3. **Thread `source_weights` through `_backtest_symbol`**

   Pass `source_weights` to `_backtest_symbol` in the call at `servicer.py:L107`:
   ```python
   trades, equity, daily_eq = await self._backtest_symbol(
       symbol=symbol,
       ...
       source_weights=source_weights,   # new argument
       ...
   )
   ```

   Add `source_weights: dict` (no default; it is always passed) to `_backtest_symbol`'s signature at `servicer.py:L176`:
   ```python
   async def _backtest_symbol(
       self,
       symbol,
       range_msg,
       fast_period,
       slow_period,
       signal_sources,
       signal_weight,
       technical_weight,
       min_conviction,
       initial_equity,
       commission,
       slippage,
       source_weights,      # new
       propagation_meta=(),
   ):
   ```

   Update the call to `_compute_signal_score` inside `_backtest_symbol` at `servicer.py:L297`:
   ```python
   signal_score = _compute_signal_score(signals_map, bar, signal_sources, source_weights=source_weights)
   ```

**Verification**:
```bash
# Confirm source_weights argument added to _compute_signal_score signature
grep -n "def _compute_signal_score" services/xstockstrat-analysis/app/handlers/servicer.py

# Confirm config key is read in RunBacktest
grep -n "source_weights\|analysis\.signals" services/xstockstrat-analysis/app/handlers/servicer.py

# Confirm clamping is present
grep -n "min(1.0\|max(0.0" services/xstockstrat-analysis/app/handlers/servicer.py

# Confirm json import at module level
grep -n "^import json" services/xstockstrat-analysis/app/handlers/servicer.py
```

---

### Step 3 — docs: Document `analysis.signals.source_weights` in analysis CLAUDE.md

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-analysis/CLAUDE.md:L54` — `## Config Keys Consumed` table with 6 existing entries (`analysis.backtest.max_duration_seconds`, `analysis.backtest.default_commission_pct`, `analysis.backtest.default_slippage_pct`, `analysis.scoring.sharpe_weight`, `analysis.scoring.drawdown_weight`, `analysis.scoring.win_rate_weight`)
- New key: `analysis.signals.source_weights`, type `string` (JSON), default `"{}"`, added at the end of the table

**Instructions**:

Append a new row to the Config Keys Consumed table in `services/xstockstrat-analysis/CLAUDE.md` after the existing `analysis.scoring.win_rate_weight` row:

```markdown
| `analysis.signals.source_weights` | string (JSON) | `"{}"` | JSON object mapping source name to reliability weight in [0.0, 1.0]. Empty → all sources use 1.0 (neutral). Values outside [0.0, 1.0] are clamped at read time. |
```

**Verification**:
```bash
grep -n "source_weights" services/xstockstrat-analysis/CLAUDE.md
# Expected: one match showing the new row in the Config Keys table
```

---

### Step 4 — test: Unit tests for weighted `_compute_signal_score` and config read path

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_helpers.py` — modify
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_analysis_helpers.py:L160` — `class TestComputeSignalScore` has 7 existing test methods testing the current unweighted logic; all use `_make_bar()` and `_make_signal()` helpers defined at lines 132–157
- `_make_signal` returns a `MagicMock` with `.direction`, `.conviction`, `.valid_from.seconds`, `.valid_until.seconds` attributes
- `_compute_signal_score` is imported from `app.handlers.servicer` at line 14 — the new `source_weights` parameter is a keyword argument with default `None`, so all existing tests continue to pass unchanged
- `make_servicer()` at `tests/test_analysis_servicer.py:L21` uses `cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: default)` — a `get_str` mock is needed to cover the new JSON read path; existing `TestRunBacktest.test_empty_symbols_returns_result` at line 158 does not mock `get_str`, so the servicer will call `get_str` with default `"{}"` — which MagicMock returns without error (returns a MagicMock, not a string), causing `json.loads` to raise; `make_servicer` must be updated to also mock `get_str`

**Instructions**:

1. **Update `make_servicer` in `tests/test_analysis_servicer.py`** to add a `get_str` mock that returns the default argument (identical pattern to the existing `get_float` mock at line 24):

   ```python
   cfg.get_str = MagicMock(side_effect=lambda key, default="": default)
   ```

2. **Add new test class to `tests/test_analysis_helpers.py`** after `TestComputeSignalScore` (append to end of file):

   ```python
   class TestComputeSignalScoreWithWeights:
       """Tests for the source_weights parameter added by signal-source-weighting (007)."""

       def test_weight_one_is_same_as_no_weight(self):
           """weight=1.0 for a source should produce the same score as no weights."""
           bar = _make_bar(1704067200)
           sig = _make_signal("buy", 0.8)
           score_no_weight = _compute_signal_score({"uw": [sig]}, bar, ["uw"])
           score_weight_one = _compute_signal_score({"uw": [sig]}, bar, ["uw"], source_weights={"uw": 1.0})
           assert score_no_weight == pytest.approx(score_weight_one, abs=1e-9)

       def test_weight_zero_silences_source(self):
           """weight=0.0 for all sources → no conviction accumulated → neutral score."""
           bar = _make_bar(1704067200)
           sig = _make_signal("buy", 0.9)
           # With weight 0.0, buy_conviction and sell_conviction stay 0 for each signal,
           # but count is still incremented → net = 0/count = 0 → score = 0.5
           score = _compute_signal_score({"uw": [sig]}, bar, ["uw"], source_weights={"uw": 0.0})
           assert score == pytest.approx(0.5, abs=1e-9)

       def test_lower_weight_reduces_influence(self):
           """source_b at weight=0.5 contributes less than source_a at weight=1.0."""
           bar = _make_bar(1704067200)
           sig_a = _make_signal("buy", 0.8)
           sig_b = _make_signal("buy", 0.8)
           # Both sources, source_b halved
           score_both_full = _compute_signal_score(
               {"a": [sig_a], "b": [sig_b]}, bar, ["a", "b"],
               source_weights={"a": 1.0, "b": 1.0}
           )
           score_b_half = _compute_signal_score(
               {"a": [sig_a], "b": [sig_b]}, bar, ["a", "b"],
               source_weights={"a": 1.0, "b": 0.5}
           )
           # Both scores are above 0.5 (buy signals), but b_half < both_full is not
           # guaranteed due to count normalization. What IS guaranteed: both > 0.5
           assert score_both_full > 0.5
           assert score_b_half > 0.5

       def test_missing_source_defaults_to_weight_one(self):
           """A source absent from source_weights gets multiplier 1.0 (FR-3)."""
           bar = _make_bar(1704067200)
           sig = _make_signal("buy", 0.8)
           score_absent = _compute_signal_score({"uw": [sig]}, bar, ["uw"], source_weights={})
           score_explicit_one = _compute_signal_score(
               {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 1.0}
           )
           assert score_absent == pytest.approx(score_explicit_one, abs=1e-9)

       def test_weight_clamped_above_one(self):
           """A weight > 1.0 is clamped to 1.0 (FR-5)."""
           bar = _make_bar(1704067200)
           sig = _make_signal("buy", 0.8)
           score_clamped = _compute_signal_score(
               {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 5.0}
           )
           score_one = _compute_signal_score(
               {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 1.0}
           )
           assert score_clamped == pytest.approx(score_one, abs=1e-9)

       def test_weight_clamped_below_zero(self):
           """A weight < 0.0 is clamped to 0.0 (FR-5)."""
           bar = _make_bar(1704067200)
           sig = _make_signal("buy", 0.8)
           score_clamped = _compute_signal_score(
               {"uw": [sig]}, bar, ["uw"], source_weights={"uw": -1.0}
           )
           score_zero = _compute_signal_score(
               {"uw": [sig]}, bar, ["uw"], source_weights={"uw": 0.0}
           )
           assert score_clamped == pytest.approx(score_zero, abs=1e-9)

       def test_signal_score_always_in_range(self):
           """Final score must be in [0.0, 1.0] under extreme weights (AC-3)."""
           bar = _make_bar(1704067200)
           sig_buy = _make_signal("buy", 1.0)
           sig_sell = _make_signal("sell", 1.0)
           for weights in [{"a": 0.0}, {"a": 1.0}, {"a": 0.5}, {}]:
               for sig, direction in [(sig_buy, "buy"), (sig_sell, "sell")]:
                   score = _compute_signal_score({"a": [sig]}, bar, ["a"], source_weights=weights)
                   assert 0.0 <= score <= 1.0, f"score={score} out of range for weights={weights}, direction={direction}"

       def test_mixed_weighted_sources(self):
           """Two sources with different weights and opposite signals."""
           bar = _make_bar(1704067200)
           sig_buy = _make_signal("buy", 1.0)
           sig_sell = _make_signal("sell", 1.0)
           # source_a (buy, weight=1.0) vs source_b (sell, weight=0.2) → net positive → score > 0.5
           score = _compute_signal_score(
               {"source_a": [sig_buy], "source_b": [sig_sell]},
               bar,
               ["source_a", "source_b"],
               source_weights={"source_a": 1.0, "source_b": 0.2},
           )
           assert score > 0.5
   ```

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40 -v tests/test_analysis_helpers.py tests/test_analysis_servicer.py
```
Confirm: all new tests pass, existing tests still pass, coverage threshold ≥ 40%.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
