"""Feature 215 — the pure fundamentals guard (``app.services.fundamentals_guard``).

Covers @AC-1 (requires_fundamentals on the real strategy shapes — fails.md 2026-08-13 / feature 129:
the fscore formula's declared FUNDAMENTAL_INPUTS, not a stub), @AC-3 (a technical strategy on an ETF
is NOT_REQUIRED) and @AC-10 (availability = "the evaluator would execute >= 1 epoch": a partial row
counts, a filing on/after the last evaluated bar does not). Also pins the guard <-> evaluator parity
(design adversary note A) and that ``epoch_eval_dates`` equals a brute-force calendar-day scan.
"""

import json
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from google.protobuf.struct_pb2 import Struct

from app.services.evaluator import (
    FundamentalPeriod,
    StrategyEvaluator,
    component_would_execute,
    fundamental_component_inputs,
)
from app.services.fundamentals_guard import (
    Availability,
    assess,
    epoch_eval_dates,
    requires_fundamentals,
)
from tests.conftest import AAPL_PIT_PERIODS, SCHD_PIT_PERIODS

_M = indicators_pb2
# The seeded fscore formula's declared inputs
# (indicators fundamentals_value_quality.FUNDAMENTAL_INPUTS).
_FSCORE_INPUTS = [
    _M.FUNDAMENTAL_METRIC_PE_RATIO,
    _M.FUNDAMENTAL_METRIC_PB_RATIO,
    _M.FUNDAMENTAL_METRIC_DIVIDEND_YIELD,
    _M.FUNDAMENTAL_METRIC_ROE,
    _M.FUNDAMENTAL_METRIC_DEBT_TO_EQUITY,
    _M.FUNDAMENTAL_METRIC_EPS,
]
_FMAP = {"fscore": _FSCORE_INPUTS}

_START = date(2025, 1, 2)
_END = date(2025, 6, 30)
_EVAL = [_START, date(2025, 3, 1), _END]


def _builtin(ref, indicator):
    return analysis_pb2.StrategyComponent(
        ref_name=ref, kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR, indicator=indicator
    )


def _formula(ref="fscore", formula_id="fscore"):
    return analysis_pb2.StrategyComponent(
        ref_name=ref, kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA, formula_id=formula_id
    )


def _operand(metric="pe_ratio"):
    return analysis_pb2.StrategyComponent(
        ref_name="pe", kind=analysis_pb2.COMPONENT_KIND_FUNDAMENTAL, fundamental_metric=metric
    )


def _definition(*components):
    return analysis_pb2.StrategyDefinition(
        strategy_id="s",
        display_name="S",
        components=list(components),
        entry_rule=json.dumps({"fn": ">", "lhs": "x", "rhs": 0}),
    )


def _blend():
    """fundamentals_macd_blend shape: fscore formula + MACD."""
    return _definition(_formula(), _builtin("macd", "MACD"))


def _squeeze():
    """squeeze_breakout_trend shape: builtins only."""
    return _definition(_builtin("macd", "MACD"), _builtin("sma", "SMA"), _builtin("atr", "ATR"))


def _assess(definition, fmap=None, eval_dates=_EVAL, **kw):
    kw.setdefault("symbol", "AAPL")
    kw.setdefault("pit", [])
    kw.setdefault("snap", None)
    kw.setdefault("failures", {})
    kw.setdefault("gate_enabled", True)
    return assess(definition, _FMAP if fmap is None else fmap, eval_dates, **kw)


class TestRequiresFundamentals:
    def test_ac1_blend_shape_requires(self):
        assert requires_fundamentals(_blend(), _FMAP) is True

    def test_ac1_squeeze_shape_does_not_require(self):
        assert requires_fundamentals(_squeeze(), _FMAP) is False

    def test_ac1_operand_only_requires(self):
        assert requires_fundamentals(_definition(_operand()), {}) is True


class TestAssessStates:
    def test_schd_empty_history_is_unavailable(self):
        assert _assess(_blend(), symbol="SCHD", pit=SCHD_PIT_PERIODS) is Availability.UNAVAILABLE

    def test_ac10_partial_row_is_available(self):
        """@AC-10 / C-16 PRESERVE @AC-8 @feature-201: a beta-only row vs {BETA, PE} executes."""
        fmap = {"fscore": [_M.FUNDAMENTAL_METRIC_BETA, _M.FUNDAMENTAL_METRIC_PE_RATIO]}
        pit = [FundamentalPeriod(filed_date=date(2024, 12, 1), values={"beta": 1.1})]
        assert _assess(_blend(), fmap, pit=pit) is Availability.AVAILABLE

    @pytest.mark.parametrize("filed", [_END, _END + timedelta(days=3)])
    def test_ac10_first_filing_on_or_after_last_bar_is_unavailable(self, filed):
        pit = [FundamentalPeriod(filed_date=filed, values={"pe_ratio": 10.0})]
        assert _assess(_blend(), pit=pit) is Availability.UNAVAILABLE

    def test_available_with_real_history(self):
        assert _assess(_blend(), pit=AAPL_PIT_PERIODS) is Availability.AVAILABLE

    def test_empty_eval_dates_is_not_assessed(self):
        assert _assess(_blend(), eval_dates=[]) is Availability.NOT_ASSESSED

    def test_bars_failed_is_not_assessed(self):
        assert (
            _assess(_blend(), pit=AAPL_PIT_PERIODS, bars_failed=True) is Availability.NOT_ASSESSED
        )

    def test_gate_off_is_not_required(self):
        assert _assess(_blend(), gate_enabled=False) is Availability.NOT_REQUIRED

    def test_ac3_technical_strategy_on_etf_is_not_required(self):
        assert _assess(_squeeze(), symbol="SCHD", pit=SCHD_PIT_PERIODS) is Availability.NOT_REQUIRED

    def test_formula_failure_on_technical_looking_map_is_unknown(self):
        failures = {("formula", "fscore"): Availability.UNKNOWN}
        assert _assess(_blend(), fmap={}, failures=failures) is Availability.UNKNOWN

    def test_pit_channel_failure_reports_its_state(self):
        failures = {("pit", "AAPL"): Availability.UNKNOWN}
        assert _assess(_blend(), pit=[], failures=failures) is Availability.UNKNOWN

    def test_operand_reads_pit(self):
        assert _assess(_definition(_operand()), {}, pit=AAPL_PIT_PERIODS) is Availability.AVAILABLE
        assert _assess(_definition(_operand("beta")), {}, pit=AAPL_PIT_PERIODS) is (
            Availability.UNAVAILABLE
        )


class TestPrecedence:
    """UNAVAILABLE > UNKNOWN > DISABLED > AVAILABLE across required components."""

    def _two(self):
        return _definition(_formula("f1", "f1"), _formula("f2", "f2"))

    def _fmap(self):
        return {"f1": [_M.FUNDAMENTAL_METRIC_PE_RATIO], "f2": [_M.FUNDAMENTAL_METRIC_EPS]}

    def test_unavailable_beats_unknown(self):
        pit = [FundamentalPeriod(filed_date=date(2024, 1, 1), values={"eps": 1.0})]
        failures = {("formula", "f2"): Availability.UNKNOWN}
        assert _assess(self._two(), self._fmap(), pit=pit, failures=failures) is (
            Availability.UNAVAILABLE
        )

    def test_unknown_beats_disabled(self):
        definition = _definition(_formula("f1", "f1"), _operand())
        failures = {
            ("formula", "f1"): Availability.UNKNOWN,
            ("pit", "AAPL"): Availability.DISABLED,
        }
        assert _assess(definition, self._fmap(), failures=failures) is Availability.UNKNOWN

    def test_disabled_beats_available(self):
        definition = _definition(_formula("f1", "f1"), _operand())
        failures = {("snap", "AAPL"): Availability.DISABLED}
        snap = []
        assert (
            _assess(definition, self._fmap(), pit=AAPL_PIT_PERIODS, snap=snap, failures=failures)
            is Availability.DISABLED
        )


class TestChannelChoice:
    """Mirrors evaluator._assemble_component_series: the formula reads snap when given, else pit;
    the 198 operand always reads pit."""

    def test_formula_reads_snapshot_when_given(self):
        snap = [FundamentalPeriod(filed_date=date.min, values={"pe_ratio": 9.0})]
        assert _assess(_blend(), pit=[], snap=snap) is Availability.AVAILABLE
        assert _assess(_blend(), pit=AAPL_PIT_PERIODS, snap=[]) is Availability.UNAVAILABLE

    def test_snap_failure_only_affects_formula_channel(self):
        failures = {("snap", "AAPL"): Availability.UNKNOWN}
        assert _assess(
            _definition(_operand()), {}, pit=AAPL_PIT_PERIODS, snap=[], failures=failures
        ) is (Availability.AVAILABLE)
        assert _assess(_blend(), pit=AAPL_PIT_PERIODS, snap=[], failures=failures) is (
            Availability.UNKNOWN
        )


def _ok_resp():
    out = Struct()
    out.update({"value": 1.0, "composite": 1.0})
    return SimpleNamespace(success=True, output=out, error="")


@pytest.mark.parametrize(
    "periods",
    [
        [],
        [FundamentalPeriod(filed_date=date(2025, 6, 30), values={"pe_ratio": 1.0})],
        [FundamentalPeriod(filed_date=date(2024, 6, 30), values={"pe_ratio": None, "eps": None})],
        [FundamentalPeriod(filed_date=date(2024, 6, 30), values={"beta": 2.0})],
        [FundamentalPeriod(filed_date=date(2025, 2, 1), values={"eps": 2.0})],
        AAPL_PIT_PERIODS,
    ],
)
@pytest.mark.asyncio
async def test_parity_would_execute_matches_execute_formula_calls(periods):
    """Design adversary note A: on the SAME eval_dates, the guard's would-execute answer equals
    whether _fundamentals_formula_series made >= 1 ExecuteFormula call."""
    stub = AsyncMock()
    stub.ExecuteFormula = AsyncMock(return_value=_ok_resp())
    ev = StrategyEvaluator(stub, propagation_meta=())
    await ev._fundamentals_formula_series(_formula(), len(_EVAL), _EVAL, periods, _FSCORE_INPUTS)
    executed = stub.ExecuteFormula.await_count >= 1
    assert component_would_execute(
        *fundamental_component_inputs(_FSCORE_INPUTS, _EVAL, periods)
    ) is (executed)


@pytest.mark.parametrize(
    "filed",
    [
        _START - timedelta(days=1),
        _START,
        date(2025, 3, 15),
        _END - timedelta(days=1),
        _END,
        _END + timedelta(days=1),
    ],
)
def test_epoch_eval_dates_matches_brute_force(filed):
    pit = [FundamentalPeriod(filed_date=filed, values={"pe_ratio": 5.0})]
    every_day = [_START + timedelta(days=i) for i in range((_END - _START).days + 1)]
    epochs = epoch_eval_dates(_START, _END, pit)
    assert epochs[0] == _START
    assert _assess(_blend(), pit=pit, eval_dates=epochs) is _assess(
        _blend(), pit=pit, eval_dates=every_day
    )
