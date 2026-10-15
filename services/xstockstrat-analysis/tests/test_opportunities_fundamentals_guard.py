"""Feature 215 (FR-3) — the opportunity engine's fundamentals skip row and its heal.

Covers @AC-4 (an entry candidate with no usable fundamentals becomes a non-actionable skip row,
ETF-labelled when known; held exits and AAPL are untouched), @AC-5 (the reason rides the row),
@AC-8 (an outage is a row-local data-unavailable row, never a skip), @AC-9 (a disabled snapshot
source is evaluated as today) and @AC-13 (a bars outage stays data-unavailable and heals into the
skip row). Real ``StrategyEvaluator`` over real ``marketdata_pb2.Bar`` times.
"""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.indicators.v1 import indicators_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf import json_format
from google.protobuf.struct_pb2 import Struct

from app.handlers.servicer import _row_to_opportunity
from tests.conftest import AAPL_PIT_PERIODS, SCHD_PIT_PERIODS
from tests.test_analysis_servicer import (
    _FakeReadinessCache,
    _materialized_svc,
    _sig,
    _strat_row,
    _unavailable_served_row,
    _wl,
)
from tests.test_backtest_fundamentals_guard import _FSCORE_INPUTS, _proto_page

_GATE = "analysis.backtest.fundamentals.enabled"
_BLEND = "fundamentals_macd_blend"
_META = [("x-user-id", "u1"), ("x-access-scope", "7"), ("x-trace-id", "t1")]
_GT_100 = {"fn": ">", "lhs": "sma", "rhs": 100.0}
_CLOSES = [120.0, 130.0, 150.0]
_A = analysis_pb2
_SKIP = "fundamentals_unavailable"


def _sma():
    return _A.StrategyComponent(
        ref_name="sma",
        kind=_A.COMPONENT_KIND_BUILTIN_INDICATOR,
        indicator="SMA",
        params={"period": 3.0},
    )


def _row(definition, symbols=None):
    if symbols is not None:
        sp = Struct()
        sp.update({"symbols": list(symbols)})
        definition.signal_params.CopyFrom(sp)
    return {
        "strategy_id": definition.strategy_id,
        "display_name": definition.strategy_id.upper(),
        "active": True,
        "live_enabled": True,
        "definition_json": json_format.MessageToDict(definition),
        "created_at": datetime(2024, 1, 1, tzinfo=UTC),
    }


def _blend_row(sid=_BLEND, *, symbols=None, exit_=None):
    """fundamentals_macd_blend shape: the fscore formula gates a technical leg."""
    return _row(
        _A.StrategyDefinition(
            strategy_id=sid,
            components=[
                _A.StrategyComponent(
                    ref_name="fscore", kind=_A.COMPONENT_KIND_CUSTOM_FORMULA, formula_id="fscore"
                ),
                _sma(),
            ],
            entry_rule=json.dumps(
                {
                    "op": "AND",
                    "conditions": [{"fn": ">", "lhs": "fscore.composite", "rhs": 0.5}, _GT_100],
                }
            ),
            exit_rule=json.dumps(exit_) if exit_ else "",
        ),
        symbols,
    )


def _operand_row(sid="pe_gate"):
    """A 198 operand strategy (reads the PIT channel)."""
    return _row(
        _A.StrategyDefinition(
            strategy_id=sid,
            components=[
                _A.StrategyComponent(
                    ref_name="pe", kind=_A.COMPONENT_KIND_FUNDAMENTAL, fundamental_metric="pe_ratio"
                ),
                _sma(),
            ],
            entry_rule=json.dumps(
                {"op": "AND", "conditions": [{"fn": ">", "lhs": "pe", "rhs": 0.0}, _GT_100]}
            ),
        )
    )


def _real_bars(symbol, closes):
    now = datetime.now(UTC)
    out = []
    for i, c in enumerate(closes):
        b = marketdata_pb2.Bar(symbol=symbol, open=c, high=c, low=c, close=c)
        b.time.FromDatetime(now - timedelta(days=len(closes) - 1 - i))
        out.append(b)
    return out


def _rpc(code):
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "x")


def _aapl_snapshot():
    row = marketdata_pb2.Fundamentals(symbol="AAPL", **AAPL_PIT_PERIODS[-1].values)
    return marketdata_pb2.GetFundamentalsResponse(fundamentals=row)


def _svc(
    *,
    watch=(),
    held=(),
    signals=(),
    strategies,
    live=(),
    bars=None,
    snap=None,
    pit=None,
    etf=True,
):
    """``_materialized_svc`` plus real bars, the gate on, and fundamentals/formula/ETF stubs.

    ``snap``/``pit`` map a symbol to a value or an exception (default: SCHD absent, AAPL full)."""
    svc = _materialized_svc(
        signals=signals,
        held=held,
        watchlists=[_wl(bindings=list(watch))],
        strategies=strategies,
        live_strategies=list(live),
    )
    svc._cfg.get_bool = MagicMock(side_effect=lambda k, d=False: True if k == _GATE else d)
    bars = {"SCHD": _CLOSES, "AAPL": _CLOSES} if bars is None else bars

    async def _batch(req, metadata=None):
        return SimpleNamespace(
            results=[
                SimpleNamespace(symbol=s, bars=_real_bars(s, bars.get(s, []))) for s in req.symbols
            ]
        )

    async def _get_bars(req, metadata=None, **_kw):
        return SimpleNamespace(
            bars=_real_bars(req.symbol, bars.get(req.symbol, [])),
            page=SimpleNamespace(next_page_token=""),
        )

    svc._marketdata.BatchGetBars = AsyncMock(side_effect=_batch)
    svc._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    snap = (
        {"SCHD": _rpc(grpc.StatusCode.NOT_FOUND), "AAPL": _aapl_snapshot()}
        if snap is None
        else snap
    )
    pit = {"SCHD": SCHD_PIT_PERIODS, "AAPL": AAPL_PIT_PERIODS} if pit is None else pit

    def _reply(table, sym, wrap):
        v = table[sym]
        if isinstance(v, Exception):
            raise v
        return wrap(v)

    svc._marketdata.GetFundamentals = AsyncMock(
        side_effect=lambda req, metadata=None, **_kw: _reply(snap, req.symbol, lambda v: v)
    )
    svc._marketdata.GetHistoricalFundamentals = AsyncMock(
        side_effect=lambda req, metadata=None, **_kw: _reply(pit, req.symbol, _proto_page)
    )
    flag = marketdata_pb2.EtfFlag(symbol="SCHD")
    if etf is not None:
        flag.is_etf = etf
    svc._marketdata.GetEtfFlags = AsyncMock(
        return_value=marketdata_pb2.GetEtfFlagsResponse(flags=[flag])
    )
    svc._indicators.GetFormula = AsyncMock(
        return_value=indicators_pb2.FormulaDefinition(
            formula_id="fscore", name="fscore", fundamental_inputs=_FSCORE_INPUTS
        )
    )
    out = Struct()
    out.update({"value": 0.7, "composite": 0.7})
    svc._indicators.ExecuteFormula = AsyncMock(
        return_value=SimpleNamespace(success=True, output=out, error="")
    )
    return svc


def _find(rows, sym, strat):
    return next(r for r in rows if r["symbol"] == sym and r["strategy_id"] == strat)


# ── @AC-4 / @AC-5: the entry skip row ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ac4_ac5_schd_skip_row_etf_labelled_aapl_evaluated():
    svc = _svc(watch=[("SCHD", _BLEND), ("AAPL", _BLEND)], strategies={_BLEND: _blend_row()})
    rows = await svc._compute_opportunities("u1", _META)

    schd = _find(rows, "SCHD", _BLEND)
    assert schd["action"] == _A.OPPORTUNITY_ACTION_TAG_UNSPECIFIED
    assert schd["composite_score"] is None
    assert schd["conviction"] == 0.0 and schd["signal_axis"] == 0.0
    assert _SKIP in schd["provenance"] and "unavailable" not in schd["provenance"]
    assert schd["readiness_json"]["fundamentals_gap"] == _A.FUNDAMENTALS_GAP_ETF
    assert schd["readiness_json"]["total_conditions"] == 0

    aapl = _find(rows, "AAPL", _BLEND)
    assert _SKIP not in aapl["provenance"] and "unavailable" not in aapl["provenance"]
    assert aapl["action"] == _A.OPPORTUNITY_ACTION_TAG_ENTER
    assert aapl["conviction"] == 1.0

    opp = _row_to_opportunity({**schd, "computed_at": datetime.now(UTC)})
    assert opp.fundamentals_unavailable is True
    assert opp.data_unavailable is False
    assert opp.fundamentals_gap == _A.FUNDAMENTALS_GAP_ETF
    meta = dict(svc._marketdata.GetEtfFlags.await_args.kwargs["metadata"])
    assert meta == dict(_META)


@pytest.mark.asyncio
async def test_ac4_unknown_etf_flag_leaves_label_absent():
    svc = _svc(watch=[("SCHD", _BLEND)], strategies={_BLEND: _blend_row()}, etf=None)
    schd = _find(await svc._compute_opportunities("u1", _META), "SCHD", _BLEND)
    assert _SKIP in schd["provenance"]
    assert "fundamentals_gap" not in schd["readiness_json"]


@pytest.mark.asyncio
async def test_held_schd_keeps_exit_reduce_row():
    svc = _svc(
        watch=[("SCHD", _BLEND)],
        held=["SCHD"],
        strategies={_BLEND: _blend_row(exit_=_GT_100)},
    )
    schd = _find(await svc._compute_opportunities("u1", _META), "SCHD", _BLEND)
    assert schd["action"] == _A.OPPORTUNITY_ACTION_TAG_REDUCE
    assert _SKIP not in schd["provenance"] and "unavailable" not in schd["provenance"]


@pytest.mark.asyncio
async def test_speculative_sell_without_position_still_dropped():
    svc = _svc(
        signals=[_sig("SCHD", "sell", 0.8)],
        strategies={_BLEND: _blend_row()},
        live=[_blend_row(symbols=["SCHD"])],
    )
    rows = await svc._compute_opportunities("u1", _META)
    assert not [r for r in rows if r["symbol"] == "SCHD" and r["strategy_id"] == _BLEND]


# ── @AC-8 / @AC-9: outages and disables are not absence ───────────────────────────────────────


@pytest.mark.asyncio
async def test_ac8_outage_rows_unavailable_technical_row_evaluated():
    svc = _svc(
        watch=[("SCHD", _BLEND), ("SCHD", "pe_gate"), ("SCHD", "tech")],
        strategies={
            _BLEND: _blend_row(),
            "pe_gate": _operand_row(),
            "tech": _strat_row("tech", entry=_GT_100),
        },
        snap={"SCHD": _rpc(grpc.StatusCode.UNAVAILABLE)},
        pit={"SCHD": _rpc(grpc.StatusCode.UNAVAILABLE)},
    )
    rows = await svc._compute_opportunities("u1", _META)
    for sid in (_BLEND, "pe_gate"):
        r = _find(rows, "SCHD", sid)
        assert "unavailable" in r["provenance"] and _SKIP not in r["provenance"]
        assert r["action"] == _A.OPPORTUNITY_ACTION_TAG_ENTER
        assert r["conviction"] == 0.0 and r["composite_score"] is None
    tech = _find(rows, "SCHD", "tech")  # SCHD never entered the symbol-wide fetch_failed set
    assert "unavailable" not in tech["provenance"]
    assert tech["conviction"] == 1.0


@pytest.mark.asyncio
async def test_ac9_disabled_snapshot_evaluated_without_markers():
    svc = _svc(
        watch=[("SCHD", _BLEND)],
        strategies={_BLEND: _blend_row()},
        snap={"SCHD": _rpc(grpc.StatusCode.FAILED_PRECONDITION)},
    )
    schd = _find(await svc._compute_opportunities("u1", _META), "SCHD", _BLEND)
    assert "unavailable" not in schd["provenance"] and _SKIP not in schd["provenance"]
    assert schd["action"] == _A.OPPORTUNITY_ACTION_TAG_ENTER
    assert schd["readiness_json"]["total_conditions"] > 0  # evaluated, so no 300s retry


@pytest.mark.asyncio
async def test_ac13_bars_outage_stays_unavailable_not_skip():
    svc = _svc(watch=[("SCHD", _BLEND)], strategies={_BLEND: _blend_row()})
    svc._marketdata.BatchGetBars = AsyncMock(side_effect=RuntimeError("bars down"))
    schd = _find(await svc._compute_opportunities("u1", _META), "SCHD", _BLEND)
    assert "unavailable" in schd["provenance"] and _SKIP not in schd["provenance"]
    assert schd["action"] == _A.OPPORTUNITY_ACTION_TAG_ENTER


@pytest.mark.asyncio
async def test_skip_row_and_sibling_indicator_outage_are_mutually_exclusive():
    svc = _svc(
        watch=[("SCHD", _BLEND), ("SCHD", "tech")],
        strategies={_BLEND: _blend_row(), "tech": _strat_row("tech", entry=_GT_100)},
    )

    async def _down(req, metadata=None):
        await asyncio.sleep(0)
        raise _rpc(grpc.StatusCode.UNAVAILABLE)

    svc._indicators.ComputeIndicator = AsyncMock(side_effect=_down)
    rows = await svc._compute_opportunities("u1", _META)
    blend = _find(rows, "SCHD", _BLEND)
    assert _SKIP in blend["provenance"] and "unavailable" not in blend["provenance"]
    assert blend["action"] == _A.OPPORTUNITY_ACTION_TAG_UNSPECIFIED
    assert blend["composite_score"] is None
    assert "unavailable" in _find(rows, "SCHD", "tech")["provenance"]


@pytest.mark.asyncio
async def test_snapshot_quota_is_unknown_row_and_retried():
    svc = _svc(
        watch=[("SCHD", _BLEND), ("SCHD", "tech")],
        strategies={_BLEND: _blend_row(), "tech": _strat_row("tech", entry=_GT_100)},
        snap={"SCHD": _rpc(grpc.StatusCode.RESOURCE_EXHAUSTED)},
    )
    rows = await svc._compute_opportunities("u1", _META)
    schd = _find(rows, "SCHD", _BLEND)
    assert "unavailable" in schd["provenance"] and _SKIP not in schd["provenance"]
    assert schd["action"] == _A.OPPORTUNITY_ACTION_TAG_ENTER
    assert schd["conviction"] == 0.0
    assert "unavailable" not in _find(rows, "SCHD", "tech")["provenance"]

    old = datetime.now(UTC) - timedelta(seconds=400)
    svc._opportunities_repo.rows["u1"] = [
        _unavailable_served_row("SCHD", _BLEND, provenance=schd["provenance"], computed_at=old)
    ]
    calls = svc._marketdata.GetFundamentals.await_count
    await svc._retry_unavailable_symbols("u1", {"SCHD"}, _META)
    assert svc._marketdata.GetFundamentals.await_count == calls + 1  # re-run on heal
    assert "unavailable" in svc._opportunities_repo.rows["u1"][0]["provenance"]


# ── @AC-13: heal into the skip row ─────────────────────────────────────────────────────────────


def _spy_heal(svc):
    real = svc._opportunities_repo.replace_symbols
    svc._opportunities_repo.replace_symbols = AsyncMock(side_effect=real)
    svc._readiness_cache_repo = _FakeReadinessCache()
    return svc._opportunities_repo.replace_symbols


@pytest.mark.asyncio
async def test_ac13_heal_rewrites_to_skip_row_without_readiness_staging():
    svc = _svc(watch=[("SCHD", _BLEND)], strategies={_BLEND: _blend_row()})
    old = datetime.now(UTC) - timedelta(seconds=400)
    svc._opportunities_repo.rows["u1"] = [
        _unavailable_served_row(
            "SCHD", _BLEND, provenance=["watchlist", "unavailable"], computed_at=old
        )
    ]
    spy = _spy_heal(svc)
    await svc._retry_unavailable_symbols("u1", {"SCHD"}, _META)
    (healed,) = spy.await_args.args[1]
    assert healed["action"] == 0
    assert _SKIP in healed["provenance"] and "unavailable" not in healed["provenance"]
    assert healed["composite_score"] is None and healed["conviction"] == 0.0
    assert healed["readiness_json"]["fundamentals_gap"] == _A.FUNDAMENTALS_GAP_ETF
    assert svc._readiness_cache_repo.upserted == []


@pytest.mark.asyncio
async def test_heal_of_technical_row_carries_no_action_key():
    svc = _svc(watch=[("SCHD", "tech")], strategies={"tech": _strat_row("tech", entry=_GT_100)})
    old = datetime.now(UTC) - timedelta(seconds=400)
    svc._opportunities_repo.rows["u1"] = [
        _unavailable_served_row(
            "SCHD", "tech", provenance=["watchlist", "unavailable"], computed_at=old
        )
    ]
    spy = _spy_heal(svc)
    await svc._retry_unavailable_symbols("u1", {"SCHD"}, _META)
    (healed,) = spy.await_args.args[1]
    assert "action" not in healed
    assert "unavailable" not in healed["provenance"] and _SKIP not in healed["provenance"]


@pytest.mark.asyncio
async def test_held_unavailable_row_heals_as_today():
    svc = _svc(watch=[("SCHD", _BLEND)], strategies={_BLEND: _blend_row(exit_=_GT_100)})
    old = datetime.now(UTC) - timedelta(seconds=400)
    svc._opportunities_repo.rows["u1"] = [
        _unavailable_served_row(
            "SCHD", _BLEND, provenance=["position", "unavailable"], computed_at=old
        )
    ]
    spy = _spy_heal(svc)
    await svc._retry_unavailable_symbols("u1", {"SCHD"}, _META)
    (healed,) = spy.await_args.args[1]
    assert "action" not in healed
    assert "unavailable" not in healed["provenance"] and _SKIP not in healed["provenance"]
    assert healed["readiness_json"]["total_conditions"] > 0
