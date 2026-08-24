"""Feature 152 — benchmark/reference-symbol operand: shared-helper parity + alignment.

Covers AC-1 (byte-identity for empty source_symbol), AC-2 (component computed on the
benchmark's own bars, no lookahead), AC-3 (missing benchmark bar → gap/hold, no
forward-fill, evaluated symbol not reindexed). Uses real ``marketdata_pb2.Bar`` instances
(``bar.time``), never MagicMock, per the Ledger 2026-08-06 trap.
"""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2

from app.services.evaluator import StrategyEvaluator, _eval_condition


def _bar(symbol: str, day: datetime, close: float) -> marketdata_pb2.Bar:
    b = marketdata_pb2.Bar(symbol=symbol, open=close, high=close, low=close, close=close)
    b.time.FromDatetime(day)
    return b


def _days(n: int, start=datetime(2025, 1, 2, tzinfo=UTC)):
    return [start + timedelta(days=i) for i in range(n)]


def _identity_stub():
    """ComputeIndicator returns one IndicatorPoint per input close (value == close)."""
    stub = AsyncMock()

    async def _compute(req, metadata=None):
        return SimpleNamespace(result=[SimpleNamespace(value=v) for v in req.values])

    stub.ComputeIndicator = AsyncMock(side_effect=_compute)
    return stub


def _sma_comp(ref_name="mkt", source_symbol=""):
    return analysis_pb2.StrategyComponent(
        ref_name=ref_name,
        kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
        indicator="SMA",
        params={"period": 1.0},
        source_symbol=source_symbol,
    )


@pytest.mark.asyncio
async def test_source_symbol_series_computed_on_benchmark_and_date_joined():
    """AC-2: mkt resolves to the indicator computed on VOO's own closes, aligned by date."""
    ev = StrategyEvaluator(_identity_stub(), propagation_meta=())
    days = _days(5)
    # Evaluated (AAPL) closes DIFFER from VOO closes — proves mkt is not AAPL's series.
    eval_bars = [_bar("AAPL", days[i], 100.0 + i) for i in range(5)]
    voo_bars = [_bar("VOO", days[i], 10.0 + i) for i in range(5)]

    definition = analysis_pb2.StrategyDefinition(
        components=[_sma_comp(source_symbol="VOO")],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
    )
    _decisions, series = await ev.evaluate_with_series(
        definition, eval_bars, None, {"VOO": voo_bars}
    )
    assert series["mkt"] == [10.0, 11.0, 12.0, 13.0, 14.0]


@pytest.mark.asyncio
async def test_missing_benchmark_bar_is_gap_hold_no_forwardfill_no_reindex():
    """AC-3: a benchmark missing one date → None at that bar (leaf false), the evaluated
    symbol keeps all its own bars, and the gap is not forward-filled."""
    ev = StrategyEvaluator(_identity_stub(), propagation_meta=())
    days = _days(5)
    eval_bars = [_bar("AAPL", days[i], 100.0) for i in range(5)]
    # VOO has NO bar for days[2] (index 2).
    voo_bars = [_bar("VOO", days[i], 10.0 + i) for i in (0, 1, 3, 4)]

    definition = analysis_pb2.StrategyDefinition(
        components=[_sma_comp(source_symbol="VOO")],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
    )
    entry_rule = json.loads(definition.entry_rule)
    _decisions, series = await ev.evaluate_with_series(
        definition, eval_bars, None, {"VOO": voo_bars}
    )
    # Evaluated symbol still has all 5 bars (never reindexed to VOO's 4).
    assert len(series["mkt"]) == 5
    # Gap at index 2, not forward-filled from index 1's 11.0.
    assert series["mkt"] == [10.0, 11.0, None, 13.0, 14.0]
    # The leaf `mkt > 0` is False at the gapped bar (hold), True at the others.
    assert _eval_condition(entry_rule, series, 2) is False
    assert _eval_condition(entry_rule, series, 1) is True


@pytest.mark.asyncio
async def test_source_symbol_with_no_benchmark_bars_is_all_none_safe_hold():
    """A source_symbol component with no benchmark bars supplied → all-None (hold),
    never computed on the evaluated symbol's closes."""
    ev = StrategyEvaluator(_identity_stub(), propagation_meta=())
    days = _days(3)
    eval_bars = [_bar("AAPL", days[i], 100.0 + i) for i in range(3)]
    definition = analysis_pb2.StrategyDefinition(
        components=[_sma_comp(source_symbol="VOO")],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
    )
    _decisions, series = await ev.evaluate_with_series(definition, eval_bars, None, {})
    assert series["mkt"] == [None, None, None]


@pytest.mark.asyncio
async def test_empty_source_symbol_is_byte_identical_to_pre_feature_path():
    """AC-1: a component with empty source_symbol computes on the evaluated symbol exactly
    as before — and does NOT require bars to carry a .time field (list-mock bars work)."""
    ev = StrategyEvaluator(_identity_stub(), propagation_meta=())
    # Bars without a .time attribute (as legacy tests build them) must still work.
    eval_bars = [SimpleNamespace(close=c, timestamp=None) for c in (5.0, 6.0, 7.0)]
    definition = analysis_pb2.StrategyDefinition(
        components=[_sma_comp(source_symbol="")],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
    )
    _decisions, series = await ev.evaluate_with_series(definition, eval_bars, None, None)
    assert series["mkt"] == [5.0, 6.0, 7.0]
