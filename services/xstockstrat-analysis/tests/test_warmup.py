"""Unit tests for the pre-window warm-up sizing module (feature 071).

Pure — no I/O, no gRPC, no DB. The lookback table is the contract these pin.
"""

import json
import math
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.marketdata.v1 import marketdata_pb2

from app.handlers.servicer import _MAX_BAR_PAGES, AnalysisServicer, _BarFetchError
from app.services import warmup


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


# ── feature 071: bounded bar pagination ──────────────────────────────────────
#
# Lives here rather than in test_analysis_servicer.py because these exercise the
# fetch helper in isolation; the servicer's own suite covers the engine paths.


def _bar(sec):
    b = marketdata_pb2.Bar(close=float(sec))
    b.time.seconds = sec
    return b


def _page(bars, token=""):
    return SimpleNamespace(bars=bars, page=SimpleNamespace(next_page_token=token))


def _svc_with_pages(pages):
    svc = AnalysisServicer.__new__(AnalysisServicer)
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(side_effect=pages)
    return svc


class TestFetchBarsPaged:
    async def test_single_page_returns_all_bars(self):
        svc = _svc_with_pages([_page([_bar(1), _bar(2)])])
        bars = await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), [])
        assert [b.time.seconds for b in bars] == [1, 2]

    async def test_follows_the_cursor_across_pages(self):
        """The regression this helper exists for: an unpaged fetch stopped at page 1 and
        silently lost the newest bars."""
        svc = _svc_with_pages(
            [
                _page([_bar(1), _bar(2)], token="t1"),
                _page([_bar(3), _bar(4)], token="t2"),
                _page([_bar(5)]),
            ]
        )
        bars = await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), [])
        assert [b.time.seconds for b in bars] == [1, 2, 3, 4, 5]
        assert svc._marketdata.GetBars.await_count == 3

    async def test_forwards_the_page_token_it_was_given(self):
        svc = _svc_with_pages([_page([_bar(1)], token="tok"), _page([_bar(2)])])
        await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), [])
        second = svc._marketdata.GetBars.await_args_list[1].args[0]
        assert second.page.page_token == "tok"

    async def test_identical_page_with_identical_token_terminates(self):
        """marketdata falls back to `cursor = start` on an unparseable page token, re-serving
        the same page with the same token. Without the monotonicity guard this loops forever."""
        repeated = [_page([_bar(1), _bar(2)], token="stuck") for _ in range(_MAX_BAR_PAGES + 5)]
        svc = _svc_with_pages(repeated)
        bars = await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), [])
        assert [b.time.seconds for b in bars] == [1, 2]
        assert svc._marketdata.GetBars.await_count == 2

    async def test_overlapping_page_keeps_only_strictly_newer_bars(self):
        svc = _svc_with_pages(
            [
                _page([_bar(1), _bar(2)], token="t1"),
                _page([_bar(2), _bar(3)]),  # re-sends the boundary bar
            ]
        )
        bars = await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), [])
        assert [b.time.seconds for b in bars] == [1, 2, 3]

    async def test_exceeding_the_page_cap_raises_rather_than_truncating(self):
        """Returning what it has would silently drop the newest bars — exactly the bug this
        helper fixes — and would do so as a function of a config value (F-07)."""
        pages = [
            _page([_bar(i)], token=f"t{i}") for i in range(1, _MAX_BAR_PAGES + 3)
        ]
        svc = _svc_with_pages(pages)
        with pytest.raises(_BarFetchError, match="refusing to return a truncated series"):
            await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), [])

    async def test_empty_first_page_returns_empty(self):
        svc = _svc_with_pages([_page([])])
        assert await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), []) == []

    async def test_full_page_with_empty_token_is_treated_as_eof(self):
        """marketdata queries LIMIT pageSize+1 and only sets a token when it saw the extra
        row, so it cannot both fill a page and forget the cursor. No probe needed."""
        svc = _svc_with_pages([_page([_bar(1), _bar(2)])])
        bars = await svc._fetch_bars_paged("AAPL", common_pb2.TimeRange(), [])
        assert len(bars) == 2
        assert svc._marketdata.GetBars.await_count == 1
