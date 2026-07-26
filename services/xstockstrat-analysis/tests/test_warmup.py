"""Unit tests for the pre-window warm-up sizing module (feature 071).

Pure — no I/O, no gRPC, no DB. The lookback table is the contract these pin.
"""

import json
import math

import pytest
from app.services import warmup
from gen.analysis.v1 import analysis_pb2


def _comp(ref_name, indicator, **params):
    return analysis_pb2.StrategyComponent(
        ref_name=ref_name,
        kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
        indicator=indicator,
        params=params,
    )


def _formula_comp(ref_name, formula_id):
    return analysis_pb2.StrategyComponent(
        ref_name=ref_name,
        kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
        formula_id=formula_id,
    )


def _defn(components, entry_rule=None, exit_rule=None):
    return analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        components=components,
        entry_rule=json.dumps(entry_rule) if entry_rule else "",
        exit_rule=json.dumps(exit_rule) if exit_rule else "",
    )


def _leaf(lhs, rhs=1.0, fn=">"):
    return {"fn": fn, "lhs": lhs, "rhs": rhs}


class TestBuiltinLookback:
    """Each expectation is derived from the indicator engine's own recurrence, plus the
    universal +1 for a crossover's `i-1` reference."""

    @pytest.mark.parametrize(
        ("indicator", "params", "expected"),
        [
            # rolling(period) first valid at period-1, +1 usable
            ("SMA", {"period": 20}, 20),
            ("BB", {"period": 20}, 20),
            # .diff() NaN at index 0 pushes rolling(period) to first-valid == period, +1
            ("RSI", {"period": 14}, 15),
            ("ATR", {"period": 14}, 15),
            # k=rolling(period) valid at period-1; d=k.rolling(3) valid at period+1; +1
            ("STOCH", {"period": 14}, 16),
            # IIR: 3x period for convergence, +1
            ("EMA", {"period": 10}, 31),
            # IIR: 3x (max(fast,slow) + signal), +1
            ("MACD", {"fast": 12, "slow": 26, "signal": 9}, 106),
            # expanding anchor, defined at index 0
            ("VWAP", {}, 0),
        ],
    )
    def test_lookback_table(self, indicator, params, expected):
        assert warmup.builtin_lookback_bars(indicator, params) == expected

    def test_indicator_name_is_case_insensitive(self):
        assert warmup.builtin_lookback_bars("sma", {"period": 20}) == 20

    def test_macd_uses_max_of_fast_and_slow(self):
        """Nothing validates fast <= slow, so an inverted pair must still be warmed for the
        larger span — otherwise the binding EMA is silently under-warmed."""
        inverted = warmup.builtin_lookback_bars("MACD", {"fast": 50, "slow": 26, "signal": 9})
        assert inverted == 3 * (50 + 9) + 1

    def test_defaults_match_the_indicator_engine(self):
        """Omitted params must resolve to the engine's defaults, not to zero."""
        assert warmup.builtin_lookback_bars("SMA", {}) == 14      # period=14
        assert warmup.builtin_lookback_bars("BB", {}) == 20       # period=20
        assert warmup.builtin_lookback_bars("RSI", {}) == 15      # period=14
        assert warmup.builtin_lookback_bars("MACD", {}) == 3 * (26 + 9) + 1

    def test_period_is_truncated_not_rounded(self):
        """The engine does int(params.get(...)); rounding would desynchronize the prefix."""
        assert warmup.builtin_lookback_bars("SMA", {"period": 20.7}) == 20

    def test_unknown_indicator_contributes_zero(self):
        assert warmup.builtin_lookback_bars("NOPE", {"period": 99}) == 0

    def test_non_numeric_param_falls_back_to_default(self):
        assert warmup.builtin_lookback_bars("SMA", {"period": "abc"}) == 14


class TestRequiredPrefixBars:
    def test_no_rules_needs_no_prefix(self):
        defn = _defn([_comp("a", "SMA", period=50)])
        assert warmup.required_prefix_bars(defn) == 0

    def test_takes_max_over_referenced_components(self):
        defn = _defn(
            [_comp("fast", "SMA", period=20), _comp("slow", "SMA", period=50)],
            entry_rule={"op": "AND", "conditions": [_leaf("fast"), _leaf("slow")]},
        )
        assert warmup.required_prefix_bars(defn) == 50

    def test_unreferenced_component_does_not_gate(self):
        """A component no active rule mentions never gates a decision, so it must not
        inflate the prefix (and force a needless coverage shortfall)."""
        defn = _defn(
            [_comp("used", "SMA", period=20), _comp("unused", "SMA", period=200)],
            entry_rule=_leaf("used"),
        )
        assert warmup.required_prefix_bars(defn) == 20

    def test_exit_rule_refs_are_counted(self):
        defn = _defn(
            [_comp("a", "SMA", period=20), _comp("b", "SMA", period=80)],
            entry_rule=_leaf("a"),
            exit_rule=_leaf("b"),
        )
        assert warmup.required_prefix_bars(defn) == 80

    def test_dotted_series_ref_resolves_to_its_base_component(self):
        defn = _defn(
            [_comp("bb", "BB", period=30)],
            entry_rule=_leaf("bb.lower"),
        )
        assert warmup.required_prefix_bars(defn) == 30

    def test_custom_formula_uses_declared_warmup_from_cache(self):
        defn = _defn([_formula_comp("z", "f-1")], entry_rule=_leaf("z"))
        assert warmup.required_prefix_bars(defn, {"f-1": 40}) == 41

    def test_custom_formula_absent_from_cache_contributes_zero(self):
        """This module is pure — it cannot call GetFormula. An unresolved formula must not
        invent a lookback (F-04)."""
        defn = _defn([_formula_comp("z", "f-1")], entry_rule=_leaf("z"))
        assert warmup.required_prefix_bars(defn, {}) == 0

    def test_rule_referencing_a_missing_component_is_ignored(self):
        defn = _defn([_comp("a", "SMA", period=20)], entry_rule=_leaf("ghost"))
        assert warmup.required_prefix_bars(defn) == 0

    def test_vwap_alone_needs_no_prefix(self):
        defn = _defn([_comp("v", "VWAP")], entry_rule=_leaf("v"))
        assert warmup.required_prefix_bars(defn) == 0

    def test_vwap_mixed_with_a_longer_component_inherits_that_prefix(self):
        """Documented consequence: VWAP is anchored at index 0, so a sibling-driven prefix
        shifts every in-window VWAP value."""
        defn = _defn(
            [_comp("v", "VWAP"), _comp("s", "SMA", period=50)],
            entry_rule={"op": "AND", "conditions": [_leaf("v"), _leaf("s")]},
        )
        assert warmup.required_prefix_bars(defn) == 50


class TestPrefixCalendarDays:
    def test_zero_bars_needs_no_calendar_span(self):
        assert warmup.prefix_calendar_days(0) == 0
        assert warmup.prefix_calendar_days(-5) == 0

    def test_converts_bars_to_calendar_days_with_slack(self):
        assert warmup.prefix_calendar_days(252) == math.ceil(252 / (252 / 365)) + 10  # 375

    @pytest.mark.parametrize("bars", [1, 5, 20, 50, 200, 504])
    def test_span_always_covers_the_requirement(self, bars):
        """The conversion must never under-request: at 252 trading days per 365 calendar
        days, the returned span must contain at least `bars` trading days."""
        days = warmup.prefix_calendar_days(bars)
        assert days * (252 / 365) >= bars

    def test_is_monotonic(self):
        spans = [warmup.prefix_calendar_days(b) for b in range(1, 300)]
        assert spans == sorted(spans)
