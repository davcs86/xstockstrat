"""Feature 215 — bounded PIT pager + error-distinct fundamentals loaders.

Covers @AC-12 (the PIT history is drained across pages so the newest filings are not lost; a page
cap / non-advancing cursor is UNKNOWN, never a silent truncation), @AC-8 (an outage is UNKNOWN,
never absence) and @AC-9 (a disabled snapshot source is DISABLED, distinct from absence).
"""

from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2
from gen.marketdata.v1 import marketdata_pb2

from app.engine.live_loop import LiveEvaluationLoop
from app.handlers.servicer import (
    _FUND_PAGE_SIZE,
    _FUND_PAGE_TIMEOUT_SECONDS,
    _MAX_FUND_PAGES,
    _fetch_historical_fundamentals_paged,
    _FundamentalsPageError,
)
from app.services.evaluator import StrategyEvaluator
from app.services.fundamentals_guard import Availability, assess
from tests.test_analysis_servicer import make_servicer

_DIV = indicators_pb2.FUNDAMENTAL_METRIC_DIVIDEND_YIELD


def _ts(d: date):
    return datetime(d.year, d.month, d.day, tzinfo=UTC)


def _period(end: date, fp: str, filed: date, **metrics):
    p = marketdata_pb2.HistoricalFundamentalsPeriod(symbol="AAPL", fiscal_period=fp, **metrics)
    p.period_end.FromDatetime(_ts(end))
    p.filed_date.FromDatetime(_ts(filed))
    return p


def _page(periods, token=""):
    return marketdata_pb2.GetHistoricalFundamentalsResponse(
        periods=periods, pagination=common_pb2.PageResponse(next_page_token=token)
    )


def _rpc_error(code):
    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "x")


def _quarters(year):
    return [
        _period(
            date(year, m, 28),
            f"Q{i}-{year}",
            date(year, m + 1, 10),
            pe_ratio=20.0,
            missing_metrics=["dividend_yield"],
        )
        for i, m in enumerate((3, 6, 9), start=1)
    ]


def _fund_definition():
    return analysis_pb2.StrategyDefinition(
        strategy_id="s",
        display_name="S",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="pe",
                kind=analysis_pb2.COMPONENT_KIND_FUNDAMENTAL,
                fundamental_metric="pe_ratio",
            )
        ],
    )


def _formula_definition():
    return analysis_pb2.StrategyDefinition(
        strategy_id="s",
        display_name="S",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="f",
                kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                formula_id="divf",
            )
        ],
    )


class TestPager:
    @pytest.mark.asyncio
    async def test_ac12_three_page_drain_keeps_newest_filings(self):
        """@AC-12: dividend_yield is reported only by the page-3 (newest) periods; draining every
        page makes a dividend-reading formula AVAILABLE (page 1 alone would read UNAVAILABLE)."""
        newest = [
            _period(date(2024, 3, 28), "Q1-2024", date(2024, 4, 10), dividend_yield=0.03),
        ]
        stub = SimpleNamespace(
            GetHistoricalFundamentals=AsyncMock(
                side_effect=[
                    _page(_quarters(2022), "t1"),
                    _page(_quarters(2023), "t2"),
                    _page(newest, ""),
                ]
            )
        )
        periods = await _fetch_historical_fundamentals_paged(stub, "AAPL", (("x-trace-id", "t"),))
        assert len(periods) == 7
        assert stub.GetHistoricalFundamentals.await_count == 3
        for call in stub.GetHistoricalFundamentals.await_args_list:
            assert call.args[0].page.page_size == _FUND_PAGE_SIZE == 200
            assert call.kwargs["timeout"] == _FUND_PAGE_TIMEOUT_SECONDS
            assert call.kwargs["metadata"] == (("x-trace-id", "t"),)
        assert [
            c.args[0].page.page_token for c in stub.GetHistoricalFundamentals.await_args_list
        ] == [
            "",
            "t1",
            "t2",
        ]
        fmap = {"divf": [_DIV]}
        evals = [date(2025, 1, 2), date(2025, 6, 30)]
        common = dict(symbol="AAPL", snap=None, failures={}, gate_enabled=True)
        assert assess(_formula_definition(), fmap, evals, pit=periods, **common) is (
            Availability.AVAILABLE
        )
        page1_only = periods[:3]
        assert assess(_formula_definition(), fmap, evals, pit=page1_only, **common) is (
            Availability.UNAVAILABLE
        )

    @pytest.mark.asyncio
    async def test_empty_token_is_eof(self):
        stub = SimpleNamespace(GetHistoricalFundamentals=AsyncMock(return_value=_page([], "")))
        assert await _fetch_historical_fundamentals_paged(stub, "SCHD", ()) == []
        assert stub.GetHistoricalFundamentals.await_count == 1

    @pytest.mark.asyncio
    async def test_repeated_first_period_raises(self):
        page = _quarters(2022)
        stub = SimpleNamespace(
            GetHistoricalFundamentals=AsyncMock(side_effect=[_page(page, "t1"), _page(page, "t2")])
        )
        with pytest.raises(_FundamentalsPageError):
            await _fetch_historical_fundamentals_paged(stub, "AAPL", ())

    @pytest.mark.asyncio
    async def test_never_ending_token_raises_after_cap(self):
        pages = [_page(_quarters(2000 + i), f"t{i}") for i in range(_MAX_FUND_PAGES + 1)]
        stub = SimpleNamespace(GetHistoricalFundamentals=AsyncMock(side_effect=pages))
        with pytest.raises(_FundamentalsPageError):
            await _fetch_historical_fundamentals_paged(stub, "AAPL", ())
        assert stub.GetHistoricalFundamentals.await_count == _MAX_FUND_PAGES


def _gated_servicer():
    svc = make_servicer()
    svc._cfg.get_bool = MagicMock(side_effect=lambda key, default=False: True)
    return svc


def _gated_loop():
    cfg = MagicMock()
    cfg.get_bool = MagicMock(side_effect=lambda key, default=False: True)
    return LiveEvaluationLoop(
        config_watcher=cfg,
        db_pool=AsyncMock(),
        marketdata_stub=AsyncMock(),
        ingest_stub=AsyncMock(),
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
        evaluator=AsyncMock(),
    )


_PIT_FAILURES = [
    _rpc_error(grpc.StatusCode.UNAVAILABLE),
    _FundamentalsPageError("page cap"),
]


class TestPitLoaders:
    @pytest.mark.parametrize("err", _PIT_FAILURES)
    @pytest.mark.asyncio
    async def test_servicer_outage_records_unknown_and_survives_cache_hit(self, err):
        """@AC-8 / @AC-12: an outage or a page error is UNKNOWN (never absence); a later cache
        hit in the same pass still sees the recorded failure."""
        svc = _gated_servicer()
        svc._marketdata.GetHistoricalFundamentals = AsyncMock(side_effect=err)
        failures, cache = {}, {}
        out = await svc._load_fundamentals(
            "AAPL", _fund_definition(), (), cache=cache, failures=failures
        )
        assert out == []
        assert failures == {("pit", "AAPL"): Availability.UNKNOWN}
        again = await svc._load_fundamentals(
            "AAPL", _fund_definition(), (), cache=cache, failures=failures
        )
        assert again == [] and svc._marketdata.GetHistoricalFundamentals.await_count == 1
        assert failures[("pit", "AAPL")] is Availability.UNKNOWN

    @pytest.mark.asyncio
    async def test_servicer_not_found_is_absence(self):
        svc = _gated_servicer()
        svc._marketdata.GetHistoricalFundamentals = AsyncMock(
            side_effect=_rpc_error(grpc.StatusCode.NOT_FOUND)
        )
        failures = {}
        assert await svc._load_fundamentals("SCHD", _fund_definition(), (), failures=failures) == []
        assert failures == {}

    @pytest.mark.parametrize("err", _PIT_FAILURES)
    @pytest.mark.asyncio
    async def test_live_outage_records_unknown(self, err):
        loop = _gated_loop()
        loop._marketdata.GetHistoricalFundamentals = AsyncMock(side_effect=err)
        failures = {}
        assert await loop._load_fundamentals(_fund_definition(), "AAPL", failures=failures) == []
        assert failures == {("pit", "AAPL"): Availability.UNKNOWN}

    @pytest.mark.asyncio
    async def test_live_pages_with_empty_metadata(self):
        loop = _gated_loop()
        loop._marketdata.GetHistoricalFundamentals = AsyncMock(
            side_effect=[_page(_quarters(2023), "t1"), _page(_quarters(2024), "")]
        )
        out = await loop._load_fundamentals(_fund_definition(), "AAPL", failures={})
        assert len(out) == 6
        assert loop._marketdata.GetHistoricalFundamentals.await_args.kwargs["metadata"] == ()


_SNAP_CASES = [
    (grpc.StatusCode.NOT_FOUND, None),
    (grpc.StatusCode.FAILED_PRECONDITION, Availability.DISABLED),
    (grpc.StatusCode.UNAVAILABLE, Availability.UNKNOWN),
    (grpc.StatusCode.RESOURCE_EXHAUSTED, Availability.UNKNOWN),
]


class TestSnapshotLoaders:
    """@AC-8/@AC-9: single-symbol GetFundamentals; NOT_FOUND is absence, FAILED_PRECONDITION is
    DISABLED, anything else (incl. RESOURCE_EXHAUSTED at the vendor quota) is UNKNOWN."""

    @pytest.mark.parametrize("code,want", _SNAP_CASES)
    @pytest.mark.asyncio
    async def test_servicer_snapshot_error_mapping(self, code, want):
        svc = _gated_servicer()
        svc._marketdata.GetFundamentals = AsyncMock(side_effect=_rpc_error(code))
        failures = {}
        out = await svc._load_fundamentals_snapshot(
            _formula_definition(), "SCHD", (), {"divf": [_DIV]}, failures=failures
        )
        assert out == []
        assert failures == ({} if want is None else {("snap", "SCHD"): want})

    @pytest.mark.parametrize("code,want", _SNAP_CASES)
    @pytest.mark.asyncio
    async def test_live_snapshot_error_mapping(self, code, want):
        loop = _gated_loop()
        loop._marketdata.GetFundamentals = AsyncMock(side_effect=_rpc_error(code))
        failures = {}
        out = await loop._load_fundamentals_snapshot(
            _formula_definition(), "SCHD", {"divf": [_DIV]}, failures=failures
        )
        assert out == []
        assert failures == ({} if want is None else {("snap", "SCHD"): want})

    @pytest.mark.asyncio
    async def test_snapshot_row_lowered_and_single_symbol_rpc(self):
        svc = _gated_servicer()
        row = marketdata_pb2.Fundamentals(symbol="AAPL", pe_ratio=12.0, missing_metrics=["eps"])
        svc._marketdata.GetFundamentals = AsyncMock(
            return_value=marketdata_pb2.GetFundamentalsResponse(fundamentals=row)
        )
        out = await svc._load_fundamentals_snapshot(
            _formula_definition(), "AAPL", (("x-trace-id", "t"),), {"divf": [_DIV]}, failures={}
        )
        assert out[0].filed_date == date.min
        assert out[0].values["pe_ratio"] == 12.0 and out[0].values["eps"] is None
        req = svc._marketdata.GetFundamentals.await_args.args[0]
        assert req.symbol == "AAPL"
        assert svc._marketdata.GetFundamentals.await_args.kwargs["metadata"] == (
            ("x-trace-id", "t"),
        )


class TestFormulaMapFailures:
    @pytest.mark.asyncio
    async def test_servicer_getformula_error_recorded(self):
        svc = _gated_servicer()
        svc._indicators.GetFormula = AsyncMock(side_effect=_rpc_error(grpc.StatusCode.UNAVAILABLE))
        failures = {}
        fmap = await svc._formula_fundamentals(_formula_definition(), (), failures=failures)
        assert fmap == {}
        assert failures == {("formula", "divf"): Availability.UNKNOWN}

    @pytest.mark.asyncio
    async def test_evaluator_getformula_error_recorded(self):
        indicators = MagicMock()
        indicators.GetFormula = AsyncMock(side_effect=_rpc_error(grpc.StatusCode.UNAVAILABLE))
        ev = StrategyEvaluator(indicators, propagation_meta=())
        failures = {}
        fmap = await ev.declared_formula_fundamentals(_formula_definition(), failures=failures)
        assert fmap == {}
        assert failures == {("formula", "divf"): Availability.UNKNOWN}
