"""Feature 215 — RunBacktest refuses a fundamentals strategy on a symbol with no fundamentals.

Covers @AC-2 (SCHD → NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE + ETF label, not ENTRY_NEVER_TRUE),
@AC-3 (technical strategies untouched), @AC-5 (a WARN names symbol + strategy), @AC-8 (an outage
is a "rerun" warning, never a refusal), @AC-10 (a filing on the last bar is not usable) and @AC-12
(a PIT page cap is UNKNOWN). Real ``StrategyEvaluator`` and real ``marketdata_pb2.Bar`` times.
"""

import json
import logging
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2
from gen.marketdata.v1 import marketdata_pb2
from google.protobuf.struct_pb2 import Struct

from app.handlers.servicer import _MAX_FUND_PAGES
from tests.conftest import AAPL_PIT_PERIODS, SCHD_PIT_PERIODS, fund_period
from tests.test_analysis_servicer import _owned_ctx, make_servicer

_GATE = "analysis.backtest.fundamentals.enabled"
_M = indicators_pb2
_FSCORE_INPUTS = [
    _M.FUNDAMENTAL_METRIC_PE_RATIO,
    _M.FUNDAMENTAL_METRIC_PB_RATIO,
    _M.FUNDAMENTAL_METRIC_DIVIDEND_YIELD,
    _M.FUNDAMENTAL_METRIC_ROE,
    _M.FUNDAMENTAL_METRIC_DEBT_TO_EQUITY,
    _M.FUNDAMENTAL_METRIC_EPS,
]
_FIRST_BAR = date(2025, 1, 2)
_N_BARS = 30
_LAST_BAR = _FIRST_BAR + timedelta(days=_N_BARS - 1)
_RERUN = "fundamentals fetch failed for SCHD — rerun"


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _bars(symbol):
    out = []
    for i in range(_N_BARS):
        close = 100.0 + i
        b = marketdata_pb2.Bar(symbol=symbol, open=close, high=close, low=close, close=close)
        b.time.FromDatetime(_dt(_FIRST_BAR + timedelta(days=i)))
        out.append(b)
    return out


def _sma():
    return analysis_pb2.StrategyComponent(
        ref_name="sma",
        kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
        indicator="SMA",
        params={"period": 2.0},
    )


def _blend():
    """fundamentals_macd_blend shape: the fscore formula gates a technical component."""
    return analysis_pb2.StrategyDefinition(
        strategy_id="fundamentals_macd_blend",
        display_name="Blend",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="fscore",
                kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                formula_id="fscore",
            ),
            _sma(),
        ],
        entry_rule=json.dumps(
            {
                "op": "AND",
                "conditions": [
                    {"fn": ">", "lhs": "fscore.composite", "rhs": 0.5},
                    {"fn": ">", "lhs": "sma", "rhs": 0.0},
                ],
            }
        ),
    )


def _squeeze():
    """squeeze_breakout_trend shape: technical builtins only."""
    return analysis_pb2.StrategyDefinition(
        strategy_id="squeeze_breakout_trend",
        display_name="Squeeze",
        components=[_sma()],
        entry_rule=json.dumps({"fn": ">", "lhs": "sma", "rhs": 0.0}),
    )


def _proto_page(periods, token=""):
    out = []
    for i, p in enumerate(periods):
        hp = marketdata_pb2.HistoricalFundamentalsPeriod(fiscal_period=f"P{i}")
        present = {k: v for k, v in p.values.items() if v is not None}
        for k, v in present.items():
            setattr(hp, k, v)
        hp.missing_metrics.extend(
            m
            for m in ("pe_ratio", "pb_ratio", "dividend_yield", "roe", "debt_to_equity", "eps")
            if m not in present
        )
        hp.filed_date.FromDatetime(_dt(p.filed_date))
        hp.period_end.FromDatetime(_dt(p.filed_date - timedelta(days=30)))
        out.append(hp)
    return marketdata_pb2.GetHistoricalFundamentalsResponse(
        periods=out, pagination=common_pb2.PageResponse(next_page_token=token)
    )


def _composite():
    out = Struct()
    out.update({"value": 0.7, "composite": 0.7})
    return SimpleNamespace(success=True, output=out, error="")


def _svc(*, gate=True, pit=None, etf=None):
    svc = make_servicer()
    svc._cfg.get_bool = MagicMock(side_effect=lambda k, d=False: gate if k == _GATE else d)
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._persist_symbol_cells = AsyncMock()
    pit = {"SCHD": SCHD_PIT_PERIODS, "AAPL": AAPL_PIT_PERIODS} if pit is None else pit
    md = MagicMock()
    md.GetBars = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            bars=_bars(req.symbol), page=SimpleNamespace(next_page_token="")
        )
    )
    md.GetHistoricalFundamentals = AsyncMock(
        side_effect=lambda req, metadata=None, timeout=None: _proto_page(pit[req.symbol])
    )
    md.GetEtfFlags = AsyncMock(
        return_value=etf
        if etf is not None
        else marketdata_pb2.GetEtfFlagsResponse(
            flags=[marketdata_pb2.EtfFlag(symbol="SCHD", is_etf=True)]
        )
    )
    svc._marketdata = md
    ind = MagicMock()
    ind.GetFormula = AsyncMock(
        return_value=indicators_pb2.FormulaDefinition(
            formula_id="fscore", name="fscore", fundamental_inputs=_FSCORE_INPUTS
        )
    )
    ind.ExecuteFormula = AsyncMock(return_value=_composite())
    ind.ComputeIndicator = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            result=[SimpleNamespace(value=v, extra={}) for v in req.values]
        )
    )
    svc._indicators = ind
    return svc


def _req(definition, symbols, *, prefixed=False):
    req = analysis_pb2.RunBacktestRequest(
        strategy_id=definition.strategy_id,
        symbols=list(symbols),
        inline_definition=definition,
        initial_capital=100_000.0,
    )
    if prefixed:  # start inside the bar series so the SMA warm-up prefix is covered
        req.range.start.FromDatetime(_dt(_FIRST_BAR + timedelta(days=10)))
        req.range.end.FromDatetime(_dt(_LAST_BAR))
    return req


def _diag(result, symbol):
    return next(d for d in result.diagnostics if d.symbol == symbol)


def _cell_symbols(svc):
    return {c["symbol"] for call in svc._persist_symbol_cells.await_args_list for c in call.args[0]}


_REFUSED = analysis_pb2.NO_TRADE_REASON_FUNDAMENTALS_UNAVAILABLE


@pytest.mark.asyncio
async def test_ac2_ac5_schd_refused_with_etf_label(caplog):
    svc = _svc()
    with caplog.at_level(logging.WARNING):
        result = await svc.RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    d = _diag(result, "SCHD")
    assert d.no_trade_reason == _REFUSED
    assert d.no_trade_reason != analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE
    assert d.fundamentals_gap == analysis_pb2.FUNDAMENTALS_GAP_ETF
    assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
    assert "SCHD" not in _cell_symbols(svc)
    assert any(
        r.levelno == logging.WARNING
        and "SCHD" in r.getMessage()
        and "fundamentals_macd_blend" in r.getMessage()
        and "fundamentals unavailable" in r.getMessage()
        for r in caplog.records
    )
    meta = dict(svc._marketdata.GetEtfFlags.await_args.kwargs["metadata"])
    assert meta["x-user-id"] == "u1" and meta["x-trace-id"] == "t1"


@pytest.mark.asyncio
async def test_aapl_traded_schd_refused_run_ok():
    svc = _svc()
    result = await svc.RunBacktest(_req(_blend(), ["AAPL", "SCHD"]), context=_owned_ctx())
    assert result.status == analysis_pb2.BACKTEST_STATUS_OK
    assert result.total_trades >= 1
    assert _diag(result, "AAPL").no_trade_reason != _REFUSED
    assert _diag(result, "SCHD").no_trade_reason == _REFUSED
    assert _cell_symbols(svc) == {"AAPL"}


@pytest.mark.asyncio
async def test_ac3_technical_strategy_on_etf_and_blend_on_aapl_untouched():
    svc = _svc()
    result = await svc.RunBacktest(_req(_squeeze(), ["SCHD"]), context=_owned_ctx())
    assert _diag(result, "SCHD").no_trade_reason != _REFUSED
    assert svc._marketdata.GetHistoricalFundamentals.await_count == 0
    result = await _svc().RunBacktest(_req(_blend(), ["AAPL"]), context=_owned_ctx())
    assert _diag(result, "AAPL").no_trade_reason != _REFUSED


@pytest.mark.asyncio
async def test_ac8_outage_is_rerun_warning_not_refusal():
    svc = _svc()
    svc._marketdata.GetHistoricalFundamentals = AsyncMock(
        side_effect=grpc.aio.AioRpcError(
            grpc.StatusCode.UNAVAILABLE, grpc.aio.Metadata(), grpc.aio.Metadata(), "down"
        )
    )
    result = await svc.RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    assert all(d.no_trade_reason != _REFUSED for d in result.diagnostics)
    assert _RERUN in result.warnings
    assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
    assert _cell_symbols(svc) == set()


@pytest.mark.asyncio
async def test_ac10_first_filing_on_last_bar_refused():
    pit = {"SCHD": [fund_period(_LAST_BAR, pe_ratio=10.0, eps=1.0)]}
    result = await _svc(pit=pit).RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    assert _diag(result, "SCHD").no_trade_reason == _REFUSED


@pytest.mark.asyncio
async def test_etf_label_failure_keeps_refusal_unlabelled():
    svc = _svc()
    svc._marketdata.GetEtfFlags = AsyncMock(side_effect=RuntimeError("marketdata down"))
    result = await svc.RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    d = _diag(result, "SCHD")
    assert d.no_trade_reason == _REFUSED
    assert d.fundamentals_gap == analysis_pb2.FUNDAMENTALS_GAP_UNSPECIFIED


@pytest.mark.asyncio
async def test_gate_off_keeps_todays_hold():
    result = await _svc(gate=False).RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    assert _diag(result, "SCHD").no_trade_reason == analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE


@pytest.mark.asyncio
async def test_ac12_page_cap_is_unknown_never_refused():
    svc = _svc()
    calls = {"n": 0}

    def _endless(req, metadata=None, timeout=None):
        calls["n"] += 1
        filed = date(2000, 1, 1) + timedelta(days=100 * calls["n"])
        return _proto_page([fund_period(filed, eps=1.0)], token=f"t{calls['n']}")

    svc._marketdata.GetHistoricalFundamentals = AsyncMock(side_effect=_endless)
    result = await svc.RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    assert all(d.no_trade_reason != _REFUSED for d in result.diagnostics)
    assert _RERUN in result.warnings
    assert svc._marketdata.GetHistoricalFundamentals.await_count == _MAX_FUND_PAGES
    assert _cell_symbols(svc) == set()


@pytest.mark.parametrize("prefixed", [True, False])
@pytest.mark.asyncio
async def test_formula_map_outage_is_unknown_with_gate_on(prefixed):
    svc = _svc()
    svc._indicators.GetFormula = AsyncMock(
        side_effect=grpc.aio.AioRpcError(
            grpc.StatusCode.UNAVAILABLE, grpc.aio.Metadata(), grpc.aio.Metadata(), "down"
        )
    )
    result = await svc.RunBacktest(
        _req(_blend(), ["AAPL", "SCHD"], prefixed=prefixed), context=_owned_ctx()
    )
    assert not result.coverage_gaps  # reached the guard, not a warm-up shortfall
    for sym in ("AAPL", "SCHD"):
        assert f"fundamentals fetch failed for {sym} — rerun" in result.warnings
    reasons = {d.no_trade_reason for d in result.diagnostics}
    assert _REFUSED not in reasons
    assert analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR not in reasons
    assert _cell_symbols(svc) == set()


@pytest.mark.asyncio
async def test_formula_map_outage_gate_off_keeps_formula_error():
    svc = _svc(gate=False)
    svc._indicators.GetFormula = AsyncMock(
        side_effect=grpc.aio.AioRpcError(
            grpc.StatusCode.UNAVAILABLE, grpc.aio.Metadata(), grpc.aio.Metadata(), "down"
        )
    )
    result = await svc.RunBacktest(_req(_blend(), ["SCHD"]), context=_owned_ctx())
    assert _diag(result, "SCHD").no_trade_reason == analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR
    assert not any("rerun" in w for w in result.warnings)
