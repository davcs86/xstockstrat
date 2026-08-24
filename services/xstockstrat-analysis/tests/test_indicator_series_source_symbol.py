"""Feature 152 — benchmark operand on GetIndicatorSeries (Step 6).

Covers AC-2 on the Symbol-page chart: a ``source_symbol`` component's series is computed on
the benchmark symbol's own bars and aligned onto the caller-supplied ``request.times``; a date
the benchmark lacks round-trips as an UNSET IndicatorValue (a gap), never a fabricated 0.0.
"""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf import json_format
from google.protobuf.timestamp_pb2 import Timestamp

from .test_analysis_servicer import _EOF_PAGE, _HEADERS, _ctx, make_servicer

_START = datetime(2025, 1, 2, tzinfo=UTC)


def _voo_bars(closes, present_offsets):
    out = []
    for off, c in zip(present_offsets, closes):
        b = marketdata_pb2.Bar(symbol="VOO", close=c)
        b.time.FromDatetime(_START + timedelta(days=off))
        out.append(b)
    return out


def _times(n):
    out = []
    for i in range(n):
        t = Timestamp()
        t.FromDatetime(_START + timedelta(days=i))
        out.append(t)
    return out


def _row():
    definition = analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        display_name="S1",
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="mkt",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 1.0},
                source_symbol="VOO",
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "mkt", "rhs": 0}),
    )
    return {
        "strategy_id": "s1",
        "display_name": "S1",
        "active": True,
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _svc(voo_bars):
    svc = make_servicer()
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_owner_and_id = AsyncMock(return_value=_row())
    svc._marketdata = MagicMock()

    async def _get_bars(req, metadata=None):
        return SimpleNamespace(page=_EOF_PAGE, bars=voo_bars if req.symbol == "VOO" else [])

    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    svc._indicators = MagicMock()
    svc._indicators.ComputeIndicator = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            result=[SimpleNamespace(value=v, extra={}) for v in req.values]
        )
    )
    return svc


@pytest.mark.asyncio
async def test_benchmark_series_aligned_onto_request_times():
    """AC-2: 'mkt' is VOO's series (identity SMA) aligned onto the 5 request.times."""
    svc = _svc(_voo_bars([10.0, 11.0, 12.0, 13.0, 14.0], present_offsets=[0, 1, 2, 3, 4]))
    req = analysis_pb2.GetIndicatorSeriesRequest(
        strategy_id="s1",
        symbol="AAPL",
        closes=[100.0, 101.0, 102.0, 103.0, 104.0],  # evaluated symbol — must NOT drive mkt
        times=_times(5),
    )
    resp = await svc.GetIndicatorSeries(req, _ctx(_HEADERS))
    comp = resp.components[0]
    assert comp.ref_name == "mkt"
    value_series = next(s for s in comp.series if s.name == "value")
    got = [iv.value if iv.HasField("value") else None for iv in value_series.values]
    assert got == [10.0, 11.0, 12.0, 13.0, 14.0]


@pytest.mark.asyncio
async def test_missing_benchmark_date_is_unset_value_not_zero():
    """A request date the benchmark lacks → UNSET IndicatorValue (gap), never a 0.0."""
    # VOO present on offsets 0,1,3,4 — missing offset 2.
    svc = _svc(_voo_bars([10.0, 11.0, 13.0, 14.0], present_offsets=[0, 1, 3, 4]))
    req = analysis_pb2.GetIndicatorSeriesRequest(
        strategy_id="s1",
        symbol="AAPL",
        closes=[100.0, 101.0, 102.0, 103.0, 104.0],
        times=_times(5),
    )
    resp = await svc.GetIndicatorSeries(req, _ctx(_HEADERS))
    value_series = next(s for s in resp.components[0].series if s.name == "value")
    assert not value_series.values[2].HasField("value")  # gap, not 0.0
    got = [iv.value if iv.HasField("value") else None for iv in value_series.values]
    assert got == [10.0, 11.0, None, 13.0, 14.0]
