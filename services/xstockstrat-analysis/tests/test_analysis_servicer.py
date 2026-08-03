"""
Unit tests for AnalysisServicer RPC methods that don't require gRPC connections.

ScoreStrategy, ListStrategies, and GetStrategyReport are exercised by
populating _backtests/_strategies directly, same pattern as ingest.
"""

import asyncio
import inspect
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2
from gen.ingest.v1 import ingest_pb2
from google.protobuf import json_format
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer, _InsufficientData
from app.services import warmup as warmup_sizing


def make_servicer() -> AnalysisServicer:
    """Return an AnalysisServicer with fully mocked dependencies."""
    cfg = MagicMock()
    # Make get_float return the default argument (mirrors real watcher behaviour)
    cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: default)
    cfg.get_str = MagicMock(side_effect=lambda key, default="": default)
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    return AnalysisServicer(
        cfg,
        marketdata_channel=MagicMock(),
        indicators_channel=MagicMock(),
        ingest_channel=MagicMock(),
        ledger_channel=MagicMock(),
    )


def _make_backtest(
    strategy_id: str = "strat-1",
    sharpe: float = 1.5,
    drawdown: float = 0.08,
    win_rate: float = 0.6,
) -> analysis_pb2.BacktestResult:
    return analysis_pb2.BacktestResult(
        backtest_id="bt-1",
        strategy_id=strategy_id,
        sharpe_ratio=sharpe,
        max_drawdown=drawdown,
        win_rate=win_rate,
    )


def _eligible_cell(symbol="AAPL", days=100, sharpe=2.0, drawdown=0.0, win_rate=1.0, trades=3):
    """A backtest_run_symbols row as fetch_eligible would return it (feature 065)."""
    return {
        "symbol": symbol,
        "sharpe_ratio": sharpe,
        "max_drawdown": drawdown,
        "win_rate": win_rate,
        "total_return": 0.12,
        "total_trades": trades,
        "trading_days": days,
    }


def _derivation_svc(cells, definition_json=None, strategy_id="s1"):
    """A no-DB servicer wired with a registered strategy row + a cells repo returning ``cells``.

    Reproduces the derived-headline path (feature 065): ScoreStrategy / recompute resolve the
    strategy row, read eligible cells, aggregate, and persist through the score funnel.
    """
    svc = make_servicer()
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_id = AsyncMock(
        return_value={
            "strategy_id": strategy_id,
            "display_name": "S1",
            "active": True,
            "live_enabled": False,
            "definition_json": definition_json or {"entry_rule": "x"},
        }
    )
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._backtest_run_symbols_repo.fetch_eligible = AsyncMock(return_value=cells)
    svc._scores_repo = AsyncMock()
    return svc


# ---------------------------------------------------------------------------
# ScoreStrategy
# ---------------------------------------------------------------------------


# feature 071: GetBars is paged now, so a fake response must carry a page whose token says
# "no more pages" — an auto-created MagicMock token would read as "another page exists".
_EOF_PAGE = SimpleNamespace(next_page_token="")


class TestScoreFromMetrics:
    """Grade-blend + letter-grade math (extracted from the old _score_from_result, feature 065)."""

    def test_blend_and_components(self):
        from app.handlers.servicer import _score_from_metrics

        overall, comps = _score_from_metrics(1.0, 0.2, 0.5, 0.4, 0.3, 0.3)
        # sharpe 1.0/2=0.5; drawdown 1-0.2/0.5=0.6; win_rate 0.5
        assert comps == pytest.approx({"sharpe": 0.5, "drawdown": 0.6, "win_rate": 0.5})
        assert overall == pytest.approx(0.4 * 0.5 + 0.3 * 0.6 + 0.3 * 0.5)

    def test_components_clamped(self):
        from app.handlers.servicer import _score_from_metrics

        _, comps = _score_from_metrics(10.0, 1.0, 5.0, 0.4, 0.3, 0.3)
        assert comps["sharpe"] == 1.0  # clamped
        assert comps["drawdown"] == 0.0  # 1 - 1/0.5 = -1 → 0
        assert comps["win_rate"] == 1.0  # clamped

    @pytest.mark.parametrize(
        "overall,grade",
        [
            (0.85, "A"),
            (0.8, "A"),
            (0.7, "B"),
            (0.65, "B"),
            (0.55, "C"),
            (0.5, "C"),
            (0.4, "D"),
            (0.35, "D"),
            (0.2, "F"),
            (0.0, "F"),
        ],
    )
    def test_grade_thresholds(self, overall, grade):
        from app.handlers.servicer import _grade

        assert _grade(overall) == grade


# ---------------------------------------------------------------------------
# RunBacktest with empty symbols — covers setup + teardown path
# ---------------------------------------------------------------------------


class TestRunBacktest:
    @pytest.mark.asyncio
    async def test_empty_symbols_returns_result(self):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s1"
        req.symbols = []
        req.initial_capital = 100_000.0
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()

        result = await svc.RunBacktest(req, context=MagicMock())
        assert result.strategy_id == "s1"
        assert "s1" in svc._backtests

    def _legacy_req(self, symbols):
        req = MagicMock()
        req.strategy_id = "s1"
        req.symbols = symbols
        req.initial_capital = 100_000.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)  # no params/inline/ref → legacy SMA path
        req.range = common_pb2.TimeRange()
        return req

    @pytest.mark.asyncio
    async def test_insufficient_data_returns_structured_gap(self):
        """AC-2: too few bars → INSUFFICIENT_DATA + coverage_gaps, not a fake flat success."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        # Only 3 bars — far below the default slow_period(50)+2.
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock(), MagicMock()]
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        result = await svc.RunBacktest(self._legacy_req(["AAPL"]), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        assert result.total_trades == 0
        assert len(result.coverage_gaps) == 1
        gap = result.coverage_gaps[0]
        assert gap.symbol == "AAPL"
        assert gap.bars_have == 3
        assert gap.bars_need == 52  # slow_period(50) + 2

    @pytest.mark.asyncio
    async def test_getbars_called_with_normalized_timeframe(self):
        """AC-3: the GetBars call uses canonical "1d" + enum, not the legacy "1Day"."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock()]  # insufficient → short-circuits after GetBars
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        await svc.RunBacktest(self._legacy_req(["AAPL"]), context=MagicMock())

        called_req = svc._marketdata.GetBars.await_args.args[0]
        assert called_req.timeframe == "1d"
        assert called_req.timeframe_enum == common_pb2.Timeframe.TIMEFRAME_1DAY


# ---------------------------------------------------------------------------
# ListStrategies
# ---------------------------------------------------------------------------


class TestListStrategies:
    @pytest.mark.asyncio
    async def test_returns_empty_when_no_strategies(self):
        svc = make_servicer()
        req = MagicMock()
        resp = await svc.ListStrategies(req, context=MagicMock())
        assert len(resp.strategies) == 0

    @pytest.mark.asyncio
    async def test_returns_all_strategies(self):
        svc = make_servicer()
        svc._strategies["s1"] = analysis_pb2.StrategyScore(strategy_id="s1", overall_score=0.7)
        svc._strategies["s2"] = analysis_pb2.StrategyScore(strategy_id="s2", overall_score=0.5)

        req = MagicMock()
        resp = await svc.ListStrategies(req, context=MagicMock())
        assert len(resp.strategies) == 2


# ---------------------------------------------------------------------------
# GetStrategyReport
# ---------------------------------------------------------------------------


class TestGetStrategyReport:
    @pytest.mark.asyncio
    async def test_aborts_when_not_found(self):
        svc = make_servicer()
        req = MagicMock()
        req.strategy_id = "missing"
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetStrategyReport(req, context)

        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_report_when_found(self):
        svc = make_servicer()
        svc._strategies["s1"] = analysis_pb2.StrategyScore(strategy_id="s1", overall_score=0.7)
        svc._backtests["s1"] = _make_backtest("s1")

        req = MagicMock()
        req.strategy_id = "s1"
        report = await svc.GetStrategyReport(req, context=MagicMock())
        assert report.strategy_id == "s1"


# ---------------------------------------------------------------------------
# RunBacktest auto-scoring + run-history persistence
# ---------------------------------------------------------------------------


class TestRunBacktestPersistence:
    def _empty_req(self, strategy_id="s1", symbols=None):
        req = MagicMock()
        req.strategy_id = strategy_id
        req.symbols = symbols if symbols is not None else []
        req.initial_capital = 100_000.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()
        return req

    @pytest.mark.asyncio
    async def test_ok_run_no_longer_upserts_per_run_headline(self):
        """feature 065: the headline is DERIVED from evidence cells, not upserted per-run.
        With no strategy registered (no strategies_repo), an OK run records history + cells but
        writes NO headline score (the derivation recompute early-returns for an ad-hoc id)."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._scores_repo = AsyncMock()

        result = await svc.RunBacktest(self._empty_req("s1"), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        # No per-run headline upsert — the run's own aggregate never becomes the grade.
        svc._scores_repo.upsert.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_ok_run_appends_history_row(self):
        """Every OK run is appended to the durable history table with its score."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_runs_repo = AsyncMock()

        result = await svc.RunBacktest(self._empty_req("s1", ["AAPL"]), context=MagicMock())

        svc._backtest_runs_repo.insert.assert_awaited_once()
        kwargs = svc._backtest_runs_repo.insert.await_args.kwargs
        assert kwargs["backtest_id"] == result.backtest_id
        assert kwargs["strategy_id"] == "s1"
        assert kwargs["status"] == "BACKTEST_STATUS_OK"
        assert kwargs["symbols"] == ["AAPL"]
        assert kwargs["overall_score"] is not None
        assert kwargs["rating"] in ("A", "B", "C", "D", "F")

    @pytest.mark.asyncio
    async def test_insufficient_run_records_history_without_score(self):
        """An INSUFFICIENT_DATA run is still recorded in history, but earns no score."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._scores_repo = AsyncMock()
        svc._backtest_runs_repo = AsyncMock()
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock(), MagicMock()]  # too few → INSUFFICIENT_DATA
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        req = self._empty_req("s1", ["AAPL"])
        result = await svc.RunBacktest(req, context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        svc._scores_repo.upsert.assert_not_awaited()  # no score for an unusable run
        svc._backtest_runs_repo.insert.assert_awaited_once()
        kwargs = svc._backtest_runs_repo.insert.await_args.kwargs
        assert kwargs["status"] == "BACKTEST_STATUS_INSUFFICIENT_DATA"
        assert kwargs["overall_score"] is None
        assert kwargs["rating"] is None

    @pytest.mark.asyncio
    async def test_score_persist_failure_never_fails_run(self):
        """A DB error while persisting the score/history is swallowed — the run still returns."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._scores_repo = AsyncMock()
        svc._scores_repo.upsert = AsyncMock(side_effect=Exception("db down"))
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.insert = AsyncMock(side_effect=Exception("db down"))

        result = await svc.RunBacktest(self._empty_req("s1"), context=MagicMock())
        assert result.strategy_id == "s1"


class TestListBacktests:
    def _row(self, backtest_id="bt-1", status="BACKTEST_STATUS_OK", overall=0.72, rating="B"):
        return {
            "backtest_id": backtest_id,
            "strategy_id": "s1",
            "status": status,
            "completed_at": None,
            "symbols": ["AAPL"],
            "total_return": 0.12,
            "annualized_return": 0.1,
            "sharpe_ratio": 1.5,
            "max_drawdown": 0.08,
            "win_rate": 0.6,
            "total_trades": 4,
            "profit_factor": 1.3,
            "overall_score": overall,
            "rating": rating,
        }

    @pytest.mark.asyncio
    async def test_returns_typed_summaries(self):
        svc = make_servicer()
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.list_by_strategy = AsyncMock(
            return_value=[self._row("bt-2"), self._row("bt-1")]
        )
        req = MagicMock()
        req.strategy_id = "s1"
        req.limit = 0  # → server default
        resp = await svc.ListBacktests(req, context=MagicMock())

        assert [r.backtest_id for r in resp.runs] == ["bt-2", "bt-1"]
        assert resp.runs[0].status == analysis_pb2.BACKTEST_STATUS_OK
        assert resp.runs[0].rating == "B"
        assert resp.runs[0].symbols == ["AAPL"]
        # limit 0 defaults to 20 at the servicer.
        assert svc._backtest_runs_repo.list_by_strategy.await_args.kwargs["limit"] == 20

    @pytest.mark.asyncio
    async def test_honours_explicit_limit(self):
        svc = make_servicer()
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.list_by_strategy = AsyncMock(return_value=[])
        req = MagicMock()
        req.strategy_id = "s1"
        req.limit = 5
        await svc.ListBacktests(req, context=MagicMock())
        assert svc._backtest_runs_repo.list_by_strategy.await_args.kwargs["limit"] == 5

    @pytest.mark.asyncio
    async def test_insufficient_run_maps_to_zero_score(self):
        svc = make_servicer()
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.list_by_strategy = AsyncMock(
            return_value=[
                self._row(status="BACKTEST_STATUS_INSUFFICIENT_DATA", overall=None, rating=None)
            ]
        )
        req = MagicMock()
        req.strategy_id = "s1"
        req.limit = 0
        resp = await svc.ListBacktests(req, context=MagicMock())
        assert resp.runs[0].status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        assert resp.runs[0].overall_score == 0.0
        assert resp.runs[0].rating == ""

    @pytest.mark.asyncio
    async def test_no_repo_returns_empty(self):
        svc = make_servicer()  # no DB → _backtest_runs_repo is None
        req = MagicMock()
        req.strategy_id = "s1"
        req.limit = 0
        resp = await svc.ListBacktests(req, context=MagicMock())
        assert list(resp.runs) == []


# ---------------------------------------------------------------------------
# ConfigWatcher getters (same _StubWatcher pattern as ingest)
# ---------------------------------------------------------------------------


class _StubWatcher(ConfigWatcher):
    def __init__(self):
        self.endpoint = "localhost:50060"
        self.namespace = "analysis"
        self._snapshot = None
        self._snapshot_event = asyncio.Event()


class TestConfigWatcherGetters:
    def test_get_str_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_str("any.key", default="x") == "x"

    def test_get_str_missing_key(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_str("missing", default="d") == "d"

    def test_get_str_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(string_val="v"))
        w._snapshot = snap
        assert w.get_str("k") == "v"

    def test_get_int_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_int("k", default=5) == 5

    def test_get_int_missing_key(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_int("k", default=7) == 7

    def test_get_int_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(int_val=42))
        w._snapshot = snap
        assert w.get_int("k") == 42

    def test_get_bool_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_bool("k", default=True) is True

    def test_get_bool_missing_key(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_bool("k", default=False) is False

    def test_get_bool_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(bool_val=True))
        w._snapshot = snap
        assert w.get_bool("k") is True

    def test_get_float_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_float("k", default=1.5) == 1.5

    def test_get_float_missing_key(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_float("k", default=2.5) == 2.5

    def test_get_float_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["k"].CopyFrom(config_pb2.ConfigValue(float_val=0.75))
        w._snapshot = snap
        assert w.get_float("k") == 0.75

    def test_sandbox_timeout_default(self):
        w = _StubWatcher()
        assert w.sandbox_timeout_ms == 5000

    def test_sandbox_memory_default(self):
        w = _StubWatcher()
        assert w.sandbox_memory_bytes == 128 * 1024 * 1024

    def test_sandbox_allowed_imports_default(self):
        w = _StubWatcher()
        imports = w.sandbox_allowed_imports
        assert "numpy" in imports
        assert "pandas" in imports

    @pytest.mark.asyncio
    async def test_wait_for_snapshot_succeeds(self):
        w = _StubWatcher()
        w._snapshot_event.set()
        await w.wait_for_snapshot(timeout_seconds=1.0)

    @pytest.mark.asyncio
    async def test_wait_for_snapshot_timeout(self):
        w = _StubWatcher()
        with pytest.raises(RuntimeError, match="Timed out"):
            await w.wait_for_snapshot(timeout_seconds=0.01)


# ---------------------------------------------------------------------------
# Strategy management RPCs (feature 047-strategy-engine)
# ---------------------------------------------------------------------------


def _valid_definition(strategy_id="sma_x", display_name="SMA X"):
    return analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name=display_name,
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="fast",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 10.0},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "fast", "rhs": 100}),
    )


def _row_for(definition):
    return {
        "strategy_id": definition.strategy_id,
        "display_name": definition.display_name,
        "active": definition.active,
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _admin_ctx():
    """A gRPC context carrying the admin x-access-scope bit (7 = READ|WRITE|ADMIN)."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=[("x-access-scope", "7")])
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
    return ctx


class TestManageStrategy:
    @pytest.mark.asyncio
    async def test_admin_gate_aborts_when_not_admin(self):
        svc = make_servicer()
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER,
            definition=_valid_definition(),
        )
        context = MagicMock()
        context.invocation_metadata = MagicMock(return_value=[("x-access-scope", "1")])  # READ only
        context.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context)
        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_register_returns_definition(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)  # feature 089: not existing
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())
        assert result.strategy_id == "sma_x"
        assert result.components[0].indicator == "SMA"
        svc._strategies_repo.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_path(self):
        svc = make_servicer()
        definition = _valid_definition(display_name="Renamed")
        _stub_update_repo(svc, _row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=definition
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())
        assert result.display_name == "Renamed"

    @pytest.mark.asyncio
    async def test_deactivate_not_found(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.deactivate = AsyncMock(return_value=None)
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_DEACTIVATE,
            definition=_valid_definition(),
        )
        context = _admin_ctx()
        context.abort = AsyncMock(side_effect=Exception("not found"))
        with pytest.raises(Exception, match="not found"):
            await svc.ManageStrategy(req, context)


class TestGetStrategy:
    @pytest.mark.asyncio
    async def test_not_found(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        req = analysis_pb2.GetStrategyRequest(strategy_id="missing")
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("not found"))
        with pytest.raises(Exception, match="not found"):
            await svc.GetStrategy(req, context)

    @pytest.mark.asyncio
    async def test_success(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.GetStrategyRequest(strategy_id="sma_x")
        result = await svc.GetStrategy(req, context=MagicMock())
        assert result.strategy_id == "sma_x"


class TestListStrategyDefinitions:
    @pytest.mark.asyncio
    async def test_empty_when_no_repo(self):
        svc = make_servicer()
        svc._strategies_repo = None
        req = analysis_pb2.ListStrategyDefinitionsRequest()
        resp = await svc.ListStrategyDefinitions(req, context=MagicMock())
        assert list(resp.definitions) == []
        assert resp.total_count == 0

    @pytest.mark.asyncio
    async def test_returns_definitions(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.list = AsyncMock(return_value=([_row_for(definition)], 1))
        req = analysis_pb2.ListStrategyDefinitionsRequest(include_inactive=False)
        resp = await svc.ListStrategyDefinitions(req, context=MagicMock())
        assert resp.total_count == 1
        assert resp.definitions[0].strategy_id == "sma_x"


class TestRunBacktestBackwardCompat:
    @pytest.mark.asyncio
    async def test_legacy_strategy_params_uses_sma_path(self):
        """A call with only strategy_params (no strategy_id_ref/inline) stays on the
        legacy SMA path (FR-8). Empty symbols → valid result without DB access."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "legacy"
        req.strategy_id_ref = ""  # no stored-strategy lookup
        req.symbols = []
        req.initial_capital = 100_000.0
        req.HasField = MagicMock(return_value=False)  # no inline_definition, no strategy_params
        req.range = common_pb2.TimeRange()

        result = await svc.RunBacktest(req, context=MagicMock())
        assert result.strategy_id == "legacy"
        assert result.backtest_id
        assert "legacy" in svc._backtests


# ---------------------------------------------------------------------------
# SetStrategyLive (feature 048)
# ---------------------------------------------------------------------------


class TestSetStrategyLive:
    @pytest.mark.asyncio
    async def test_requires_admin_scope(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        req = MagicMock()
        req.strategy_id = "s1"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "1")]  # READ only
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.SetStrategyLive(req, ctx)
        ctx.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_permits_admin_scope(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        # Feature 089: enabling precondition-checks active + signal_params.symbols via get_by_id.
        live_row = {
            "strategy_id": "s1",
            "display_name": "S1",
            "active": True,
            "live_enabled": True,
            "definition_json": {"strategy_id": "s1", "signal_params": {"symbols": ["AAPL"]}},
        }
        svc._strategies_repo.get_by_id = AsyncMock(return_value=live_row)
        svc._strategies_repo.set_live_enabled = AsyncMock(return_value=live_row)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock()
        req.strategy_id = "s1"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]  # ADMIN|WRITE|READ
        resp = await svc.SetStrategyLive(req, ctx)
        assert resp.definition.strategy_id == "s1"
        assert resp.definition.live_enabled is True

    @pytest.mark.asyncio
    async def test_returns_not_found_for_missing_strategy(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        # Feature 089: on enable the NOT_FOUND now comes from the get_by_id precondition fetch.
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.set_live_enabled = AsyncMock(return_value=None)
        req = MagicMock()
        req.strategy_id = "missing"
        req.live_enabled = True
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.SetStrategyLive(req, ctx)


# ---------------------------------------------------------------------------
# ScreenSymbols (feature 060)
# ---------------------------------------------------------------------------


class TestScreenSymbols:
    @staticmethod
    def _ctx():
        ctx = MagicMock()
        ctx.invocation_metadata = MagicMock(
            return_value=[
                ("x-user-id", "u1"),
                ("x-access-scope", "7"),
                ("x-trace-id", "t1"),
            ]
        )
        return ctx

    @staticmethod
    def _svc():
        svc = make_servicer()
        # screener reads get_int — return the supplied defaults.
        svc._cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
        # feature 083 — the screener now computes RSI/ATR raw columns per symbol; give the
        # indicators stub an awaitable ComputeIndicator so those best-effort calls succeed.
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            return_value=SimpleNamespace(result=[SimpleNamespace(value=1.0)])
        )
        return svc

    @staticmethod
    def _bars(closes):
        from types import SimpleNamespace

        from gen.marketdata.v1 import marketdata_pb2

        return SimpleNamespace(page=_EOF_PAGE, bars=[marketdata_pb2.Bar(close=c) for c in closes])

    @staticmethod
    def _formula_resp(value):
        from types import SimpleNamespace

        from google.protobuf.struct_pb2 import Struct

        out = Struct()
        out.update({"value": value})
        return SimpleNamespace(success=True, output=out, error="")

    @pytest.mark.asyncio
    async def test_ranks_universe_and_forwards_headers(self):
        from gen.analysis.v1 import analysis_pb2

        svc = self._svc()
        svc._marketdata.GetBars = AsyncMock(return_value=self._bars([1.0, 2.0, 3.0]))
        svc._indicators.ExecuteFormula = AsyncMock(
            side_effect=[
                self._formula_resp([0.1]),
                self._formula_resp([0.9]),
                self._formula_resp([0.5]),
            ]
        )

        req = analysis_pb2.ScreenSymbolsRequest(
            symbols=["AAA", "BBB", "CCC"],
            criteria=[
                analysis_pb2.ScreenCriterion(
                    ref_name="f1",
                    kind=analysis_pb2.SCREEN_KIND_TECHNICAL_FORMULA,
                    component=analysis_pb2.StrategyComponent(formula_id="fid"),
                    op=analysis_pb2.COMPARATOR_GT,
                    threshold=0.0,
                    weight=1.0,
                )
            ],
        )
        resp = await svc.ScreenSymbols(req, self._ctx())
        assert len(resp.results) == 3
        assert resp.results[0].symbol == "BBB"  # highest normalized value
        # Header propagation forwarded to the new ExecuteFormula call.
        meta = dict(svc._indicators.ExecuteFormula.await_args.kwargs["metadata"])
        assert meta["x-user-id"] == "u1"
        assert meta["x-trace-id"] == "t1"

    @pytest.mark.asyncio
    async def test_insufficient_data_marked_not_dropped(self):
        from gen.analysis.v1 import analysis_pb2

        svc = self._svc()
        svc._marketdata.GetBars = AsyncMock(return_value=self._bars([]))  # no bars
        svc._indicators.ExecuteFormula = AsyncMock(return_value=self._formula_resp([0.5]))

        req = analysis_pb2.ScreenSymbolsRequest(
            symbols=["AAA"],
            criteria=[
                analysis_pb2.ScreenCriterion(
                    ref_name="f1",
                    kind=analysis_pb2.SCREEN_KIND_TECHNICAL_FORMULA,
                    component=analysis_pb2.StrategyComponent(formula_id="fid"),
                    op=analysis_pb2.COMPARATOR_GT,
                    threshold=0.0,
                )
            ],
        )
        resp = await svc.ScreenSymbols(req, self._ctx())
        assert len(resp.results) == 1
        assert resp.results[0].status == analysis_pb2.SCREEN_RESULT_STATUS_INSUFFICIENT_DATA

    @pytest.mark.asyncio
    async def test_fundamental_skipped_when_rpc_absent(self):
        """FR-5: a fundamental hard-filter is skipped (scan completes) when fundamentals fail."""
        import grpc
        from gen.analysis.v1 import analysis_pb2

        svc = self._svc()
        svc._marketdata.GetBars = AsyncMock(return_value=self._bars([1.0, 2.0, 3.0]))
        svc._marketdata.GetFundamentalsMulti = AsyncMock(side_effect=grpc.RpcError())

        req = analysis_pb2.ScreenSymbolsRequest(
            symbols=["AAA"],
            criteria=[
                analysis_pb2.ScreenCriterion(
                    ref_name="cheap",
                    kind=analysis_pb2.SCREEN_KIND_FUNDAMENTAL,
                    metric_name="pe_ratio",
                    op=analysis_pb2.COMPARATOR_LT,
                    threshold=20.0,
                    hard_filter=True,
                )
            ],
        )
        resp = await svc.ScreenSymbols(req, self._ctx())
        assert len(resp.results) == 1
        assert "cheap" not in resp.results[0].criterion_scores
        assert resp.results[0].passed is True

    @pytest.mark.asyncio
    async def test_unknown_metric_aborts_invalid_argument(self):
        """feature 090: a fundamental metric_name typo → INVALID_ARGUMENT, not a silent skip."""
        from gen.analysis.v1 import analysis_pb2
        from gen.marketdata.v1 import marketdata_pb2

        svc = self._svc()
        svc._marketdata.GetBars = AsyncMock(return_value=self._bars([1.0, 2.0, 3.0]))
        svc._marketdata.GetFundamentalsMulti = AsyncMock(
            return_value=SimpleNamespace(
                fundamentals=[marketdata_pb2.Fundamentals(symbol="AAA", pe_ratio=15.0)]
            )
        )
        ctx = self._ctx()
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))

        req = analysis_pb2.ScreenSymbolsRequest(
            symbols=["AAA"],
            criteria=[
                analysis_pb2.ScreenCriterion(
                    ref_name="cheap",
                    kind=analysis_pb2.SCREEN_KIND_FUNDAMENTAL,
                    metric_name="pe_ration",  # typo of pe_ratio
                    op=analysis_pb2.COMPARATOR_LT,
                    threshold=20.0,
                )
            ],
        )
        with pytest.raises(Exception, match="aborted"):
            await svc.ScreenSymbols(req, ctx)
        assert ctx.abort.await_args.args[0].name == "INVALID_ARGUMENT"


# ---------------------------------------------------------------------------
# RunFundamentalsScan (feature 062)
# ---------------------------------------------------------------------------


def _scan_req(force=False, dry_run=False, symbols=()):
    req = MagicMock()
    req.force = force
    req.dry_run = dry_run
    req.symbols = list(symbols)
    return req


class TestRunFundamentalsScan:
    @pytest.mark.asyncio
    async def test_requires_admin_scope(self):
        svc = make_servicer()
        svc._fundsignal_loop = AsyncMock()
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "1")]  # READ only
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.RunFundamentalsScan(_scan_req(), ctx)
        ctx.abort.assert_called_once()
        svc._fundsignal_loop.run_once.assert_not_called()

    @pytest.mark.asyncio
    async def test_unavailable_when_loop_not_initialized(self):
        svc = make_servicer()
        svc._fundsignal_loop = None
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]  # admin
        ctx.abort = AsyncMock(side_effect=Exception("unavailable"))
        with pytest.raises(Exception, match="unavailable"):
            await svc.RunFundamentalsScan(_scan_req(), ctx)
        ctx.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_admin_happy_path_maps_summary(self):
        svc = make_servicer()
        summary = analysis_pb2.FundamentalsScanSummary(
            run_id="run-xyz",
            symbols_processed=10,
            signals_emitted=4,
            calls_spent=1,
            deferred_count=0,
            status="completed",
        )
        svc._fundsignal_loop = MagicMock()
        svc._fundsignal_loop.run_once = AsyncMock(return_value=summary)
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [
            ("x-access-scope", "7"),
            ("x-user-id", "u1"),
            ("x-trace-id", "t1"),
        ]
        resp = await svc.RunFundamentalsScan(_scan_req(symbols=["AAPL", "MSFT"]), ctx)
        assert resp.run_id == "run-xyz"
        assert resp.signals_emitted == 4
        assert resp.calls_spent == 1
        assert resp.deferred_count == 0
        assert resp.status == "completed"
        # Caller metadata is propagated and the explicit symbol override is forwarded.
        kwargs = svc._fundsignal_loop.run_once.call_args.kwargs
        assert kwargs["override_symbols"] == ["AAPL", "MSFT"]
        meta_keys = {k for k, _ in kwargs["metadata"]}
        assert meta_keys == {"x-access-scope", "x-user-id", "x-trace-id"}

    @pytest.mark.asyncio
    async def test_dry_run_passes_through(self):
        svc = make_servicer()
        svc._fundsignal_loop = MagicMock()
        svc._fundsignal_loop.run_once = AsyncMock(
            return_value=analysis_pb2.FundamentalsScanSummary(status="completed")
        )
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]
        await svc.RunFundamentalsScan(_scan_req(dry_run=True), ctx)
        assert svc._fundsignal_loop.run_once.call_args.kwargs["dry_run"] is True
        # No explicit symbols → override_symbols is None (use computed universe).
        assert svc._fundsignal_loop.run_once.call_args.kwargs["override_symbols"] is None


# ---------------------------------------------------------------------------
# Per-bar diagnostics (feature 064-backtest-debug-info) — Steps 8-11
# ---------------------------------------------------------------------------

from types import SimpleNamespace  # noqa: E402

from gen.indicators.v1 import indicators_pb2  # noqa: E402
from gen.marketdata.v1 import marketdata_pb2  # noqa: E402


def _bar(sec, close, o=None, h=None, low=None, vol=100):
    b = marketdata_pb2.Bar(
        open=o if o is not None else close,
        high=h if h is not None else close,
        low=low if low is not None else close,
        close=close,
        volume=vol,
        vwap=close,
    )
    b.time.seconds = sec
    return b


def _points(values):
    # Real ComputeIndicator contract: warm-up rows are omitted from the result, so a
    # shorter list describes the LAST len(values) bars (the servicer tail-aligns it).
    return SimpleNamespace(result=[SimpleNamespace(value=v) for v in values])


class TestBacktestDiagnostics:
    def _svc_with(self, bars, fast_series, slow_series):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=[_points(fast_series), _points(slow_series)]
        )
        return svc

    def _legacy_req(self, symbols=("AAPL",), fast=2, slow=3):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=list(symbols), initial_capital=100_000.0
        )
        req.strategy_params.update({"fast_period": fast, "slow_period": slow})
        req.range.CopyFrom(common_pb2.TimeRange())
        return req

    @pytest.mark.asyncio
    async def test_legacy_diagnostics_full_backtest(self):
        # 6 bars; fast=2, slow=3. Golden cross at bar 3 (entry), death cross at bar 5 (exit).
        bars = [_bar(1000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        fast = [9, 10, 12, 13, 9]  # 5 points → warm-up row dropped, tail-aligned to bars 1..5
        slow = [11, 11, 11, 11]  # 4 points → bars 2..5
        svc = self._svc_with(bars, fast, slow)

        result = await svc.RunBacktest(self._legacy_req(), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        assert len(result.diagnostics) == 1
        sd = result.diagnostics[0]
        # FR-1/2: one row per bar, bar 0 captured with correct OHLCV + timestamp
        assert sd.bars_total == 6
        assert len(sd.bars) == 6
        assert sd.bars[0].bar_index == 0
        assert sd.bars[0].close == 10.0
        assert sd.bars[0].timestamp.seconds == 1000
        # warm-up: warmup_bars = first bar where BOTH SMAs resolve (max(1, 2) = 2)
        assert sd.warmup_bars == 2
        assert sd.bars[0].warmup is True
        assert sd.bars[0].action == analysis_pb2.BAR_ACTION_WARMUP
        assert sd.bars[2].warmup is False
        # present-only indicators: bar 1 has sma_fast (idx1 resolved) but NOT sma_slow
        assert dict(sd.bars[1].indicators) == {"sma_fast": 9.0}
        assert dict(sd.bars[3].indicators) == {"sma_fast": 12.0, "sma_slow": 11.0}
        # AC-3: ENTER/EXIT bars match the TradeRecord entry/exit times
        assert len(result.trades) == 1
        trade = result.trades[0]
        assert sd.bars[3].action == analysis_pb2.BAR_ACTION_ENTER_LONG
        assert sd.bars[3].timestamp.seconds == trade.entry_time.seconds
        assert sd.bars[5].action == analysis_pb2.BAR_ACTION_EXIT_LONG
        assert sd.bars[5].timestamp.seconds == trade.exit_time.seconds
        assert sd.bars[4].action == analysis_pb2.BAR_ACTION_HOLD_LONG
        # traded symbol → no_trade_reason UNSPECIFIED
        assert sd.no_trade_reason == analysis_pb2.NO_TRADE_REASON_UNSPECIFIED

    @pytest.mark.asyncio
    async def test_no_trade_reason_entry_never_true(self):
        # fast never crosses above slow → 0 trades, past warm-up → ENTRY_NEVER_TRUE
        bars = [_bar(2000 + i, c) for i, c in enumerate([10, 10, 10, 10, 10])]
        fast = [8, 8, 8, 8]
        slow = [11, 11, 11]
        svc = self._svc_with(bars, fast, slow)
        result = await svc.RunBacktest(self._legacy_req(), context=MagicMock())
        assert result.total_trades == 0
        sd = result.diagnostics[0]
        assert sd.warmup_bars < sd.bars_total
        assert sd.no_trade_reason == analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE

    @pytest.mark.asyncio
    async def test_ledger_completed_event_has_no_diagnostics(self):
        # AC-5: the completion ledger payload carries only summary metrics, never diagnostics.
        bars = [_bar(3000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        svc = self._svc_with(bars, [9, 10, 12, 13, 9], [11, 11, 11, 11])
        await svc.RunBacktest(self._legacy_req(), context=MagicMock())
        completed = svc._ledger.AppendEvent.await_args_list[-1].args[0]
        assert completed.event_type == "analysis.backtest.completed"
        assert "diagnostics" not in dict(completed.payload.fields)

    @pytest.mark.asyncio
    async def test_no_look_ahead_warmup_and_series(self):
        # AC-4: a bar's warmup flag + indicators are identical whether the range ends there
        # or extends beyond it.
        full = [_bar(4000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        svc_full = self._svc_with(full, [9, 10, 12, 13, 9], [11, 11, 11, 11])
        r_full = await svc_full.RunBacktest(self._legacy_req(), context=MagicMock())
        trunc = full[:5]
        svc_tr = self._svc_with(trunc, [9, 10, 12, 13], [11, 11, 11])
        r_tr = await svc_tr.RunBacktest(self._legacy_req(), context=MagicMock())
        for i in range(5):
            a, b = r_full.diagnostics[0].bars[i], r_tr.diagnostics[0].bars[i]
            assert a.warmup == b.warmup
            assert dict(a.indicators) == dict(b.indicators)

    @pytest.mark.asyncio
    async def test_insufficient_data_yields_no_diagnostics_mislabel(self):
        # FR-9: insufficient-data symbols become CoverageGap, never a no_trade_reason mislabel.
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(
                page=_EOF_PAGE, bars=[_bar(1, 10), _bar(2, 11), _bar(3, 12)]
            )
        )
        result = await svc.RunBacktest(self._legacy_req(), context=MagicMock())
        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        assert len(result.coverage_gaps) == 1
        assert len(result.diagnostics) == 0  # never entered the bar loop

    def _def_req(self, definition):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=["AAPL"], initial_capital=100_000.0
        )
        req.inline_definition.CopyFrom(definition)
        req.range.CopyFrom(common_pb2.TimeRange())
        return req

    @pytest.mark.asyncio
    async def test_evaluated_indicators_drops_value_alias(self):
        bars = [_bar(5000 + i, c) for i, c in enumerate([10, 20, 30])]
        definition = analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="bb",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="BB",
                    params={"period": 2.0},
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "bb.upper", "rhs": 100}),
        )
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            return_value=SimpleNamespace(
                result=[
                    SimpleNamespace(value=10.0, extra={"upper": 15.0, "lower": 5.0}),
                    SimpleNamespace(value=20.0, extra={"upper": 25.0, "lower": 15.0}),
                    SimpleNamespace(value=30.0, extra={"upper": 35.0, "lower": 25.0}),
                ]
            )
        )
        result = await svc.RunBacktest(self._def_req(definition), context=MagicMock())
        keys = set(dict(result.diagnostics[0].bars[2].indicators))
        assert "bb" in keys and "bb.upper" in keys and "bb.lower" in keys
        assert "bb.value" not in keys  # redundant alias dropped

    @pytest.mark.asyncio
    async def test_formula_warmup_uses_declared_not_observed(self):
        # An all-None formula primary series must NOT inflate warmup to len(bars); the declared
        # warmup_period (via GetFormula) is used → ENTRY_NEVER_TRUE, not ENTIRE_RANGE_WARMUP.
        # feature 067: an all-null (warm-up) series is produced legitimately (success=True with
        # a length-n null "value"), not via success=False — a failed formula now raises
        # FormulaExecutionError (→ NO_TRADE_REASON_FORMULA_ERROR), a distinct outcome.
        from google.protobuf.struct_pb2 import Struct

        bars = [_bar(6000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 15])]
        definition = analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="ff",
                    kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                    formula_id="f-1",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "ff", "rhs": 0}),
        )
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        # A legitimate all-warm-up series: success=True with a full-length null "value".
        out = Struct()
        out.update({"value": [None] * len(bars)})
        svc._indicators.ExecuteFormula = AsyncMock(
            return_value=SimpleNamespace(success=True, output=out, error="")
        )
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-1", warmup_period=3)
        )
        result = await svc.RunBacktest(self._def_req(definition), context=MagicMock())
        sd = result.diagnostics[0]
        assert sd.warmup_bars == 3  # declared, not len(bars)=6
        assert result.total_trades == 0
        assert sd.no_trade_reason == analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE
        svc._indicators.GetFormula.assert_awaited()


class TestFormulaErrorSurfacing:
    """feature 067 — a failing custom-formula surfaces a distinct FORMULA_ERROR diagnostic,
    and an all-failed run reports INSUFFICIENT_DATA without persisting a spurious score."""

    def _req(self, definition, symbols):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=symbols, initial_capital=100_000.0
        )
        req.inline_definition.CopyFrom(definition)
        req.range.CopyFrom(common_pb2.TimeRange())
        return req

    def _formula_def(self):
        return analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="ff",
                    kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                    formula_id="f-1",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "ff", "rhs": 0}),
        )

    def _wire(self, svc, bars, execute_side_effect):
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ExecuteFormula = AsyncMock(side_effect=execute_side_effect)
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-1", warmup_period=0)
        )

    @pytest.mark.asyncio
    async def test_partial_run_stamps_formula_error_and_keeps_sibling(self):
        from google.protobuf.struct_pb2 import Struct

        bars = [_bar(7000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 15])]
        ok_out = Struct()
        ok_out.update({"value": [1.0] * len(bars)})  # sibling trades (ff > 0)
        # AAPL formula fails (success=False → FormulaExecutionError); MSFT succeeds.
        side_effect = [
            SimpleNamespace(success=False, output=Struct(), error="boom"),
            SimpleNamespace(success=True, output=ok_out, error=""),
        ]
        svc = make_servicer()
        self._wire(svc, bars, side_effect)
        persisted_cells = {}

        async def _spy(cells, **kw):
            persisted_cells["cells"] = list(cells)

        svc._persist_symbol_cells = AsyncMock(side_effect=_spy)

        result = await svc.RunBacktest(
            self._req(self._formula_def(), ["AAPL", "MSFT"]), MagicMock()
        )

        by_symbol = {d.symbol: d for d in result.diagnostics}
        assert by_symbol["AAPL"].no_trade_reason == analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR
        assert not by_symbol["AAPL"].bars  # bars=[] for the failed symbol
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK  # partial success stays OK
        # MSFT kept its feature-065 evidence cell.
        cell_symbols = {c["symbol"] for c in persisted_cells.get("cells", [])}
        assert "MSFT" in cell_symbols
        assert "AAPL" not in cell_symbols

    @pytest.mark.asyncio
    async def test_all_failed_run_is_insufficient_and_unscored(self):
        from google.protobuf.struct_pb2 import Struct

        bars = [_bar(7100 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 15])]
        side_effect = [
            SimpleNamespace(success=False, output=Struct(), error="boom"),
            SimpleNamespace(success=False, output=Struct(), error="boom"),
        ]
        svc = make_servicer()
        self._wire(svc, bars, side_effect)
        svc._persist_backtest_run = AsyncMock()

        result = await svc.RunBacktest(
            self._req(self._formula_def(), ["AAPL", "MSFT"]), MagicMock()
        )

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        assert result.total_trades == 0
        # Both symbols surface a FORMULA_ERROR diagnostic.
        reasons = {d.symbol: d.no_trade_reason for d in result.diagnostics}
        assert reasons == {
            "AAPL": analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR,
            "MSFT": analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR,
        }
        # No per-run score persisted for a no-usable-evidence run.
        svc._persist_backtest_run.assert_awaited_once()
        assert svc._persist_backtest_run.await_args.args[2] is None  # score arg

    def test_classify_no_trade_reason_never_returns_formula_error(self):
        from app.handlers.servicer import _classify_no_trade_reason

        # FORMULA_ERROR is stamped ONLY by the RunBacktest loop branch, never by classification.
        for trades in ([], [object()]):
            for warmup in (0, 3, 10):
                for n in (0, 3, 6):
                    assert (
                        _classify_no_trade_reason(trades, warmup, n)
                        != analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR
                    )


class TestBacktestRangeCap:
    def _svc(self):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        # Enough bars so the legacy path runs (>= slow_period(3)+2); values irrelevant here.
        # feature 071: they straddle DAY (the explicit start these tests use) so an
        # explicit-start run has the pre-window history the warm-up prefix now requires.
        svc._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(
                page=_EOF_PAGE, bars=[_bar(i * 86_400, 10) for i in range(8)]
            )
        )
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=lambda *a, **k: _points([9, 10, 11, 12, 13])
        )
        return svc

    def _req(self, start_sec, end_sec):
        req = analysis_pb2.RunBacktestRequest(
            strategy_id="s1", symbols=["AAPL"], initial_capital=100_000.0
        )
        req.strategy_params.update({"fast_period": 2, "slow_period": 3})
        if start_sec is not None:
            req.range.start.seconds = start_sec
        if end_sec is not None:
            req.range.end.seconds = end_sec
        return req

    @pytest.mark.asyncio
    async def test_over_cap_range_rejected(self):
        # span 800 days > 730-day cap → INVALID_ARGUMENT (AC-7)
        svc = self._svc()
        ctx = MagicMock()
        ctx.abort = AsyncMock(side_effect=Exception("aborted"))
        req = self._req(1, 800 * 86_400)
        with pytest.raises(Exception):
            await svc.RunBacktest(req, ctx)
        assert ctx.abort.await_args.args[0].name == "INVALID_ARGUMENT"

    @pytest.mark.asyncio
    async def test_at_cap_range_runs(self):
        svc = self._svc()
        # Start at day 4 so 4 pre-window bars exist — slow_period(3) needs 3 (feature 071).
        req = self._req(4 * 86_400, 4 * 86_400 + 700 * 86_400)  # 700-day span < 730 cap
        result = await svc.RunBacktest(req, MagicMock())
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK

    @pytest.mark.asyncio
    async def test_unset_range_defaulted_to_cap_window(self):
        svc = self._svc()
        req = self._req(None, None)  # both unset (agent case)
        result = await svc.RunBacktest(req, MagicMock())
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        # the range was defaulted in place to a ~730-day window ending "now"
        span = req.range.end.seconds - req.range.start.seconds
        assert span == 730 * 86_400
        assert req.range.end.seconds > 0


# Score persistence + hydrate (feature 064 — persist-strategy-scores)
# ---------------------------------------------------------------------------


class TestScorePersistence:
    @pytest.mark.asyncio
    async def test_score_persists_via_upsert(self):
        svc = _derivation_svc([_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C")])

        req = MagicMock()
        req.strategy_id = "s1"
        score = await svc.ScoreStrategy(req, context=MagicMock())

        svc._scores_repo.upsert.assert_awaited_once()
        args = svc._scores_repo.upsert.await_args.args
        assert args[0] == "s1"
        assert args[1] == pytest.approx(score.overall_score)
        assert args[2] == score.rating
        assert set(args[3].keys()) == {"sharpe", "drawdown", "win_rate"}

    @pytest.mark.asyncio
    async def test_fr7_persist_failure_does_not_lose_read(self):
        """A swallowed DB write still returns the score AND keeps it readable (AC-6)."""
        svc = _derivation_svc([_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C")])
        svc._scores_repo.upsert.side_effect = Exception("db down")

        req = MagicMock()
        req.strategy_id = "s1"
        score = await svc.ScoreStrategy(req, context=MagicMock())

        # No abort/raise — the score is returned despite the write failure.
        assert score.strategy_id == "s1"
        # Reads serve from memory, so the caller reads its own write back.
        resp = await svc.ListStrategies(MagicMock(), context=MagicMock())
        assert any(s.strategy_id == "s1" for s in resp.strategies)

    @pytest.mark.asyncio
    async def test_hydrate_scores_populates_memory_from_db(self):
        """Restart-survivability proof (AC-1/AC-7): DB rows -> in-memory dict."""
        svc = make_servicer()
        svc._scores_repo = AsyncMock()
        svc._scores_repo.list = AsyncMock(
            return_value=[
                {
                    "strategy_id": "s1",
                    "overall_score": 0.82,
                    "rating": "A",
                    "component_scores": {"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6},
                }
            ]
        )

        await svc.hydrate_scores()

        assert "s1" in svc._strategies
        got = svc._strategies["s1"]
        assert got.overall_score == pytest.approx(0.82)
        assert got.rating == "A"
        assert dict(got.component_scores) == pytest.approx(
            {"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6}
        )

    @pytest.mark.asyncio
    async def test_hydrate_scores_noop_without_repo(self):
        svc = make_servicer()  # no db_pool -> _scores_repo is None
        assert svc._scores_repo is None
        await svc.hydrate_scores()  # must not raise
        assert svc._strategies == {}

    def test_row_to_score_roundtrip(self):
        from app.handlers.servicer import _row_to_score

        row = {
            "strategy_id": "s1",
            "overall_score": 0.5,
            "rating": "C",
            "component_scores": {"sharpe": 0.4, "drawdown": 0.6},
        }
        score = _row_to_score(row)
        assert score.strategy_id == "s1"
        assert score.overall_score == pytest.approx(0.5)
        assert score.rating == "C"
        assert dict(score.component_scores) == pytest.approx({"sharpe": 0.4, "drawdown": 0.6})


# ---------------------------------------------------------------------------
# feature 065 — definition fingerprint (module-level, no DB)
# ---------------------------------------------------------------------------


class TestDefinitionFingerprint:
    def test_display_name_active_live_excluded(self):
        from app.handlers.servicer import _definition_fingerprint

        base = {"strategy_id": "s1", "entry_rule": '{"op":"AND"}', "display_name": "A"}
        renamed = {**base, "display_name": "Totally Different Name"}
        toggled = {**base, "active": False, "live_enabled": True}
        assert _definition_fingerprint(base) == _definition_fingerprint(renamed)
        assert _definition_fingerprint(base) == _definition_fingerprint(toggled)

    def test_entry_rule_change_changes_hash(self):
        from app.handlers.servicer import _definition_fingerprint

        a = {"strategy_id": "s1", "entry_rule": '{"op":"AND"}'}
        b = {"strategy_id": "s1", "entry_rule": '{"op":"OR"}'}
        assert _definition_fingerprint(a) != _definition_fingerprint(b)

    def test_key_order_shuffle_same_hash(self):
        from app.handlers.servicer import _definition_fingerprint

        a = {"strategy_id": "s1", "entry_rule": "x", "exit_rule": "y"}
        b = {"exit_rule": "y", "entry_rule": "x", "strategy_id": "s1"}
        assert _definition_fingerprint(a) == _definition_fingerprint(b)

    def test_none_and_empty_handled(self):
        from app.handlers.servicer import _definition_fingerprint

        assert _definition_fingerprint(None) == _definition_fingerprint({})
        assert isinstance(_definition_fingerprint({}), str)


# ---------------------------------------------------------------------------
# feature 065 — per-symbol evidence cell buffering + fingerprint stamping
# ---------------------------------------------------------------------------


class TestRunBacktestCells:
    def _req(self, strategy_id="s1", strategy_id_ref="", symbols=("AAPL", "MSFT")):
        req = MagicMock()
        req.strategy_id = strategy_id
        req.strategy_id_ref = strategy_id_ref
        req.symbols = list(symbols)
        req.initial_capital = 100_000.0
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()
        return req

    def _wire(self, svc):
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_run_symbols_repo = AsyncMock()

    @staticmethod
    def _fake_sma():
        # AAPL: 2 winning trades over 10 trading days; MSFT: zero trades over 5 days.
        trade = analysis_pb2.TradeRecord(pnl=1.0)
        diag = analysis_pb2.SymbolDiagnostics()

        def fake_symbol(symbol=None, **kwargs):
            if symbol == "AAPL":
                return ([trade, trade], 101_000.0, [100_000.0] * 11, diag)
            return ([], 101_000.0, [101_000.0] * 6, diag)

        return fake_symbol

    @pytest.mark.asyncio
    async def test_ok_run_buffers_one_cell_per_symbol_incl_zero_trade(self):
        svc = make_servicer()
        self._wire(svc)
        svc._backtest_symbol = AsyncMock(side_effect=self._fake_sma())

        result = await svc.RunBacktest(self._req(), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        svc._backtest_run_symbols_repo.insert_many.assert_awaited_once()
        cells = svc._backtest_run_symbols_repo.insert_many.await_args.args[0]
        by_symbol = {c["symbol"]: c for c in cells}
        assert set(by_symbol) == {"AAPL", "MSFT"}
        assert by_symbol["AAPL"]["total_trades"] == 2
        assert by_symbol["AAPL"]["trading_days"] == 10
        # Zero-trade cell IS buffered — non-participation counts as evidence.
        assert by_symbol["MSFT"]["total_trades"] == 0
        assert by_symbol["MSFT"]["trading_days"] == 5
        # bare strategy_id (no ref) → no fingerprint on any cell.
        assert all(c["definition_fingerprint"] is None for c in cells)

    @pytest.mark.asyncio
    async def test_registered_own_run_stamps_fingerprint(self):
        from app.handlers.servicer import _definition_fingerprint

        svc = make_servicer()
        self._wire(svc)
        definition_json = {"strategy_id": "s1", "entry_rule": '{"op":"AND"}'}
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(
            return_value={
                "strategy_id": "s1",
                "display_name": "S1",
                "active": True,
                "live_enabled": False,
                "definition_json": definition_json,
            }
        )
        diag = analysis_pb2.SymbolDiagnostics()
        curve = [100_000.0, 100_100.0, 100_200.0]
        svc._backtest_symbol_evaluated = AsyncMock(
            side_effect=lambda symbol=None, **kw: ([], 100_000.0, curve, diag)
        )

        req = self._req(strategy_id="s1", strategy_id_ref="s1", symbols=("AAPL",))
        await svc.RunBacktest(req, context=MagicMock())

        cells = svc._backtest_run_symbols_repo.insert_many.await_args.args[0]
        expected = _definition_fingerprint(definition_json)
        assert cells and all(c["definition_fingerprint"] == expected for c in cells)

    @pytest.mark.asyncio
    async def test_id_mismatch_stamps_none(self):
        svc = make_servicer()
        self._wire(svc)
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(
            return_value={
                "strategy_id": "other",
                "display_name": "Other",
                "active": True,
                "live_enabled": False,
                "definition_json": {"entry_rule": "x"},
            }
        )
        diag = analysis_pb2.SymbolDiagnostics()
        svc._backtest_symbol_evaluated = AsyncMock(
            side_effect=lambda symbol=None, **kw: ([], 100_000.0, [100_000.0, 100_100.0], diag)
        )
        # strategy_id "s1" differs from strategy_id_ref "other" → cells carry no fingerprint.
        req = self._req(strategy_id="s1", strategy_id_ref="other", symbols=("AAPL",))
        await svc.RunBacktest(req, context=MagicMock())

        cells = svc._backtest_run_symbols_repo.insert_many.await_args.args[0]
        assert cells and all(c["definition_fingerprint"] is None for c in cells)

    @pytest.mark.asyncio
    async def test_insufficient_run_flushes_no_cells(self):
        svc = make_servicer()
        self._wire(svc)
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock(), MagicMock()]  # too few → INSUFFICIENT
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        result = await svc.RunBacktest(self._req(symbols=("AAPL",)), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        svc._backtest_run_symbols_repo.insert_many.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_cells_flush_failure_never_fails_run(self):
        svc = make_servicer()
        self._wire(svc)
        svc._backtest_run_symbols_repo.insert_many = AsyncMock(side_effect=Exception("db down"))
        svc._backtest_symbol = AsyncMock(side_effect=self._fake_sma())

        result = await svc.RunBacktest(self._req(), context=MagicMock())
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK  # swallowed

    @pytest.mark.asyncio
    async def test_range_passed_to_run_history_insert(self):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_runs_repo = AsyncMock()
        req = self._req(symbols=())
        req.range.start.seconds = 1_600_000_000
        req.range.end.seconds = 1_600_864_000  # 10 days, within cap

        await svc.RunBacktest(req, context=MagicMock())

        kwargs = svc._backtest_runs_repo.insert.await_args.kwargs
        assert kwargs["range_start"] is not None
        assert kwargs["range_end"] is not None


# ---------------------------------------------------------------------------
# feature 065 — _aggregate_cells (empirical-Bayes shrinkage)
# ---------------------------------------------------------------------------


class TestAggregateCells:
    def test_perfect_evidence_reaches_A_threshold(self):
        from app.handlers.servicer import _aggregate_cells, _grade

        # OQ-1 anchor: total W=375 trading days of perfect (s=1.0) evidence, k=250 → exactly 0.8.
        cells = [(375, 1.0, {"sharpe": 1.0, "drawdown": 1.0, "win_rate": 1.0})]
        overall, comps, n, days = _aggregate_cells(cells, k=250)
        assert overall == pytest.approx(0.8)  # (375 + 0.5*250) / (375 + 250)
        assert _grade(overall) == "A"
        assert n == 1 and days == 375

    def test_single_short_perfect_cell_shrinks_below_B(self):
        from app.handlers.servicer import _aggregate_cells, _grade

        # OQ-1 anchor: one 60-day perfect cell → (60 + 125)/310 ≈ 0.597 (< 0.65 B threshold).
        overall, comps, n, days = _aggregate_cells([(60, 1.0, {"sharpe": 1.0})], k=250)
        assert overall == pytest.approx(185 / 310, abs=1e-9)
        assert _grade(overall) == "C"

    def test_zero_weight_returns_none(self):
        from app.handlers.servicer import _aggregate_cells

        assert _aggregate_cells([(0, 1.0, {"sharpe": 1.0})], k=250) is None
        assert _aggregate_cells([], k=250) is None

    def test_component_weighted_mean_then_shrunk(self):
        from app.handlers.servicer import _aggregate_cells

        # weights 100 & 300 (sum ≠ 1 → renormalized); component 'sharpe' 0.9 and 0.5.
        cells = [(100, 0.9, {"sharpe": 0.9}), (300, 0.5, {"sharpe": 0.5})]
        overall, comps, n, days = _aggregate_cells(cells, k=200)
        # weighted sharpe numerator = 100*0.9 + 300*0.5 = 240; shrunk = (240 + 0.5*200)/(400+200).
        assert comps["sharpe"] == pytest.approx(340 / 600)
        # overall uses the same weighted s values → identical shrinkage here.
        assert overall == pytest.approx(340 / 600)
        assert days == 400

    def test_nonfinite_component_value_never_emitted(self):
        from app.handlers.servicer import _aggregate_cells

        cells = [(100, 0.5, {"drawdown": 0.5, "sharpe": float("inf")})]
        overall, comps, n, days = _aggregate_cells(cells, k=100)
        assert all(math.isfinite(v) for v in comps.values())
        assert math.isfinite(overall)
        assert "drawdown" in comps

    def test_zero_trade_cell_pulls_blend_down(self):
        from app.handlers.servicer import _aggregate_cells, _score_from_metrics

        # A zero-trade cell scores ≈ 0.3 (drawdown 1.0 only); it drags a strong cell down.
        s_zero, c_zero = _score_from_metrics(0.0, 0.0, 0.0, 0.4, 0.3, 0.3)  # ≈ 0.3
        s_good, c_good = _score_from_metrics(2.0, 0.0, 1.0, 0.4, 0.3, 0.3)  # = 1.0
        strong_only = _aggregate_cells([(200, s_good, c_good)], k=250)[0]
        with_zero = _aggregate_cells([(200, s_good, c_good), (200, s_zero, c_zero)], k=250)[0]
        assert with_zero < strong_only


# ---------------------------------------------------------------------------
# feature 065 — recompute triggers (RunBacktest / ManageStrategy UPDATE / ScoreStrategy)
# ---------------------------------------------------------------------------


def _rule(rhs=1):
    """A valid entry-rule tree referencing component 'a'. Vary `rhs` to change the fingerprint."""
    return json.dumps({"fn": ">", "lhs": "a", "rhs": rhs})


def _update_req(strategy_id="s1", rhs=1, mask_paths=None):
    """A REAL ManageStrategyRequest — not a MagicMock.

    feature 070 reads `request.HasField("update_mask")`, and a MagicMock returns a truthy
    sentinel for that, which would silently drive every test down the partial-merge path.
    The rule must also be valid JSON now: the UPDATE branch validates the merged definition
    directly (with pre-fetched formula outputs) instead of via the stubbable
    `_validate_definition_proto`.
    """
    definition = analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name="S1",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="a",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 10.0},
            )
        ],
        entry_rule=_rule(rhs),
    )
    req = analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=definition
    )
    if mask_paths is not None:
        req.update_mask.paths.extend(mask_paths)
    return req


def _stub_update_repo(svc, current_row):
    """Wire a strategies repo for the feature-070 merge path.

    `update_locked` genuinely invokes the apply_fn against `current_row`, so tests exercise the
    real merge / erasure-guard / validation logic instead of mocking past it.
    """
    repo = AsyncMock()
    repo.get_by_id = AsyncMock(return_value=current_row)

    async def _locked(strategy_id, apply_fn):
        name, new_json = await apply_fn(current_row)
        return {**current_row, "display_name": name, "definition_json": new_json}

    repo.update_locked = AsyncMock(side_effect=_locked)
    svc._strategies_repo = repo
    return repo


def _updated_row(strategy_id="s1", rhs=1):
    return {
        "strategy_id": strategy_id,
        "display_name": "S1",
        "active": True,
        "live_enabled": False,
        "definition_json": {
            "components": [
                {
                    "ref_name": "a",
                    "kind": "COMPONENT_KIND_BUILTIN_INDICATOR",
                    "indicator": "SMA",
                    "params": {"period": 10.0},
                }
            ],
            "entry_rule": _rule(rhs),
        },
    }


class TestHeadlineTriggers:
    @pytest.mark.asyncio
    async def test_ok_run_derives_headline_from_cells(self):
        # A registered own run: the persisted grade comes from the cells (400-day perfect),
        # not the single run's own (flat, near-zero) aggregate.
        svc = _derivation_svc([_eligible_cell(days=400, sharpe=2.0, drawdown=0.0, win_rate=1.0)])
        svc._backtest_run_symbols_repo.insert_many = AsyncMock()
        diag = analysis_pb2.SymbolDiagnostics()
        svc._backtest_symbol_evaluated = AsyncMock(
            side_effect=lambda symbol=None, **kw: ([], 100_000.0, [100_000.0, 100_050.0], diag)
        )
        req = MagicMock()
        req.strategy_id = "s1"
        req.strategy_id_ref = "s1"
        req.symbols = ["AAPL"]
        req.initial_capital = 100_000.0
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()

        await svc.RunBacktest(req, context=MagicMock())

        svc._scores_repo.upsert.assert_awaited()
        kwargs = svc._scores_repo.upsert.await_args.kwargs
        assert kwargs["n_symbols"] == 1
        assert kwargs["total_trading_days"] == 400
        assert kwargs["provisional"] is True  # 1 < 3 symbols and 400 < 500 days
        assert svc._strategies["s1"].evidence_days == 400

    @pytest.mark.asyncio
    async def test_update_clears_inmemory_even_when_delete_raises(self):
        svc = _derivation_svc([])  # zero eligible cells after the definition change
        svc._strategies["s1"] = analysis_pb2.StrategyScore(
            strategy_id="s1", overall_score=0.9, rating="A"
        )
        _stub_update_repo(svc, _updated_row())
        svc._scores_repo.delete = AsyncMock(side_effect=Exception("db down"))
        svc._has_admin_scope = lambda ctx: True

        await svc.ManageStrategy(_update_req(), context=MagicMock())

        # Unconditional pop FIRST — the stale grade is gone even though recompute/delete failed.
        assert "s1" not in svc._strategies

    @pytest.mark.asyncio
    async def test_update_recompute_no_deadlock(self):
        # UPDATE holds the lock then calls the inner (non-reentrant) recompute — must not deadlock.
        svc = _derivation_svc([_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C", "D")])
        _stub_update_repo(svc, _updated_row())
        svc._has_admin_scope = lambda ctx: True

        await asyncio.wait_for(svc.ManageStrategy(_update_req(), context=MagicMock()), timeout=2.0)

        svc._scores_repo.upsert.assert_awaited_once()  # recompute ran under the same lock


def _abort_ctx():
    context = MagicMock()
    context.abort = AsyncMock(side_effect=Exception("aborted"))
    return context


class TestScoreStrategyRecompute:
    @pytest.mark.asyncio
    async def test_store_unavailable(self):
        svc = make_servicer()  # no strategies_repo
        req = MagicMock()
        req.strategy_id = "s1"
        ctx = _abort_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE

    @pytest.mark.asyncio
    async def test_unregistered_not_found(self):
        svc = _derivation_svc([])
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        req = MagicMock()
        req.strategy_id = "nope"
        ctx = _abort_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    @pytest.mark.asyncio
    async def test_zero_eligible_clears_and_not_found(self):
        svc = _derivation_svc([])
        svc._strategies["s1"] = analysis_pb2.StrategyScore(
            strategy_id="s1", overall_score=0.9, rating="A"
        )
        req = MagicMock()
        req.strategy_id = "s1"
        ctx = _abort_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, ctx)
        assert "s1" not in svc._strategies  # stale grade popped
        svc._scores_repo.delete.assert_awaited_once()  # non-best-effort delete
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    @pytest.mark.asyncio
    async def test_cells_read_failure_unavailable_no_mutation(self):
        svc = _derivation_svc([])
        svc._backtest_run_symbols_repo.fetch_eligible = AsyncMock(side_effect=Exception("db down"))
        svc._strategies["s1"] = analysis_pb2.StrategyScore(
            strategy_id="s1", overall_score=0.9, rating="A"
        )
        req = MagicMock()
        req.strategy_id = "s1"
        ctx = _abort_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE
        assert "s1" in svc._strategies  # untouched — no prior-state mutation

    @pytest.mark.asyncio
    async def test_success_persists_provenance_and_emits(self):
        svc = _derivation_svc(
            [
                _eligible_cell(symbol=s, days=600, sharpe=2.0, drawdown=0.0, win_rate=1.0)
                for s in ("A", "B", "C")
            ]
        )
        req = MagicMock()
        req.strategy_id = "s1"

        score = await svc.ScoreStrategy(req, context=MagicMock())

        assert score.strategy_id == "s1"
        assert score.evidence_symbols == 3
        assert score.evidence_days == 1800
        assert score.provisional is False  # 3 >= 3 symbols and 1800 >= 500 days
        assert score.rating == "A"
        svc._scores_repo.upsert.assert_awaited_once()
        svc._ledger.AppendEvent.assert_awaited()  # guarded ledger emit still fires

    @pytest.mark.asyncio
    async def test_range_is_ignored(self):
        # ScoreStrategyRequest.range is documented as ignored — a set range changes nothing.
        svc = _derivation_svc([_eligible_cell(symbol=s, days=600) for s in ("A", "B", "C")])
        req = MagicMock()
        req.strategy_id = "s1"
        req.range = common_pb2.TimeRange(
            start=Timestamp(seconds=1_600_000_000), end=Timestamp(seconds=1_600_864_000)
        )
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.evidence_days == 1800  # whole eligible base, not a windowed subset


class TestHydrateProvenance:
    @pytest.mark.asyncio
    async def test_hydrate_preserves_provenance(self):
        svc = make_servicer()
        svc._scores_repo = AsyncMock()
        svc._scores_repo.list = AsyncMock(
            return_value=[
                {
                    "strategy_id": "s1",
                    "overall_score": 0.7,
                    "rating": "B",
                    "component_scores": {"sharpe": 0.6},
                    "n_symbols": 5,
                    "total_trading_days": 900,
                    "provisional": False,
                }
            ]
        )
        await svc.hydrate_scores()
        got = svc._strategies["s1"]
        assert got.evidence_symbols == 5
        assert got.evidence_days == 900
        assert got.provisional is False

    def test_row_to_score_pre007_row_defaults(self):
        from app.handlers.servicer import _row_to_score

        # A pre-007 row has no provenance keys — must hydrate with zero/false defaults.
        row = {
            "strategy_id": "s1",
            "overall_score": 0.7,
            "rating": "B",
            "component_scores": {},
        }
        score = _row_to_score(row)
        assert score.evidence_symbols == 0
        assert score.evidence_days == 0
        assert score.provisional is False


class TestTradedFirstDedupContract:
    @pytest.mark.asyncio
    async def test_aggregation_consumes_fetch_eligible_result(self):
        # The traded-first dedup lives in the fetch_eligible SQL (asserted in
        # test_backtest_run_symbols_repo.py). The servicer trusts that result: given a symbol's
        # traded 100-day cell is what fetch_eligible returns, the grade reflects it (not a
        # hypothetical 500-day zero-trade cell that the SQL ordering would have discarded).
        traded = _eligible_cell(symbol="AAPL", days=100, sharpe=2.0, win_rate=1.0, trades=5)
        svc = _derivation_svc([traded])
        req = MagicMock()
        req.strategy_id = "s1"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.evidence_days == 100  # the traded cell's window, per fetch_eligible


# ---------------------------------------------------------------------------
# Feature 068 — engine equity capture (per-bar equity + effective initial capital)
# ---------------------------------------------------------------------------


class TestEquityCapture:
    def test_finalize_stamps_equity_per_bar(self):
        """_finalize_symbol_diagnostics copies daily_equity[i] onto bars[i].equity."""
        from app.handlers.servicer import _build_bar_diagnostic, _finalize_symbol_diagnostics

        bars = [_bar(1000 + i, 10.0 + i) for i in range(4)]
        hold = analysis_pb2.BAR_ACTION_HOLD_FLAT
        diags = [
            _build_bar_diagnostic("AAPL", i, b, {}, 0.0, 0.0, hold, False)
            for i, b in enumerate(bars)
        ]
        daily_equity = [100_000.0, 100_100.0, 99_950.0, 100_200.0]
        sd = _finalize_symbol_diagnostics("AAPL", diags, 1, [], daily_equity)
        assert [b.equity for b in sd.bars] == daily_equity
        # forced-close consistency: the (patched) last daily_equity value lands on the last bar
        assert sd.bars[-1].equity == daily_equity[-1]

    @pytest.mark.asyncio
    async def test_full_backtest_bars_carry_equity_and_initial_capital(self):
        """End-to-end: a traded legacy run stamps per-bar equity and the effective seed."""
        bars = [_bar(1000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 9])]
        fast = [9, 10, 12, 13, 9]
        slow = [11, 11, 11, 11]
        svc = TestBacktestDiagnostics()._svc_with(bars, fast, slow)
        req = TestBacktestDiagnostics()._legacy_req()

        result = await svc.RunBacktest(req, context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        assert result.initial_capital == 100_000.0
        sd = result.diagnostics[0]
        # bar 0 carries the seed; every bar carries a positive portfolio value
        assert sd.bars[0].equity == 100_000.0
        assert all(b.equity > 0 for b in sd.bars)
        # the traded run changes equity after entry (bar 3 onward differs from the seed)
        assert sd.bars[4].equity != 100_000.0

    @pytest.mark.asyncio
    async def test_effective_initial_capital_default(self):
        """request.initial_capital omitted/0 → the engine's 100k default is stamped."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock()
        req.strategy_id = "s1"
        req.symbols = []
        req.initial_capital = 0.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()

        result = await svc.RunBacktest(req, context=MagicMock())
        assert result.initial_capital == 100_000.0

    @pytest.mark.asyncio
    async def test_effective_initial_capital_explicit(self):
        """An explicit request capital is stamped verbatim."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock()
        req.strategy_id = "s1"
        req.symbols = []
        req.initial_capital = 25_000.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()

        result = await svc.RunBacktest(req, context=MagicMock())
        assert result.initial_capital == 25_000.0


# ---------------------------------------------------------------------------
# Feature 068 — detail persistence + GetBacktest (DB-only read path)
# ---------------------------------------------------------------------------


class TestBacktestDetailPersistence:
    def _empty_req(self, strategy_id="s1", symbols=None):
        req = MagicMock()
        req.strategy_id = strategy_id
        req.symbols = symbols if symbols is not None else []
        req.initial_capital = 100_000.0
        req.strategy_id_ref = ""
        req.HasField = MagicMock(return_value=False)
        req.range = common_pb2.TimeRange()
        return req

    @pytest.mark.asyncio
    async def test_ok_run_persists_detail_bytes(self):
        """An OK run serializes the full result into the details repo with retention 20."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_details_repo = AsyncMock()

        result = await svc.RunBacktest(self._empty_req("s1"), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_OK
        svc._backtest_details_repo.insert.assert_awaited_once()
        kwargs = svc._backtest_details_repo.insert.await_args.kwargs
        assert kwargs["backtest_id"] == result.backtest_id
        assert kwargs["strategy_id"] == "s1"
        assert kwargs["completed_at"] == result.completed_at.ToDatetime()
        assert kwargs["result_pb"] == result.SerializeToString()
        assert kwargs["retention"] == 20  # MagicMock cfg returns the call-site default

    @pytest.mark.asyncio
    async def test_retention_clamped_to_at_least_one(self):
        """A negative configured retention is clamped to 1, never passed to SQL raw."""
        svc = make_servicer()
        svc._cfg.get_int = MagicMock(
            side_effect=lambda key, default=0: (
                -5 if key == "analysis.backtest.detail_retention_per_strategy" else default
            )
        )
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_details_repo = AsyncMock()

        await svc.RunBacktest(self._empty_req("s1"), context=MagicMock())

        assert svc._backtest_details_repo.insert.await_args.kwargs["retention"] == 1

    @pytest.mark.asyncio
    async def test_insufficient_run_persists_no_detail(self):
        """INSUFFICIENT_DATA runs get a history row but never a detail row (FR-6)."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_details_repo = AsyncMock()
        bars_resp = MagicMock()
        bars_resp.bars = [MagicMock(), MagicMock(), MagicMock()]  # too few bars
        bars_resp.page.next_page_token = ""
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=bars_resp)

        result = await svc.RunBacktest(self._empty_req("s1", ["AAPL"]), context=MagicMock())

        assert result.status == analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        svc._backtest_details_repo.insert.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_detail_persist_failure_never_fails_run(self):
        """A DB error while persisting detail is swallowed (best-effort)."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_details_repo = AsyncMock()
        svc._backtest_details_repo.insert = AsyncMock(side_effect=RuntimeError("db down"))

        result = await svc.RunBacktest(self._empty_req("s1"), context=MagicMock())
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK  # run still returned

    @pytest.mark.asyncio
    async def test_parity_history_metrics_equal_detail_bytes(self):
        """AC-4 / C-10(b): the seven ListBacktests metrics equal the deserialized detail's."""
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_details_repo = AsyncMock()

        await svc.RunBacktest(self._empty_req("s1"), context=MagicMock())

        history = svc._backtest_runs_repo.insert.await_args.kwargs
        detail = analysis_pb2.BacktestResult()
        detail.ParseFromString(svc._backtest_details_repo.insert.await_args.kwargs["result_pb"])
        assert history["metrics"]["total_return"] == detail.total_return
        assert history["metrics"]["annualized_return"] == detail.annualized_return
        assert history["metrics"]["sharpe_ratio"] == detail.sharpe_ratio
        assert history["metrics"]["max_drawdown"] == detail.max_drawdown
        assert history["metrics"]["win_rate"] == detail.win_rate
        assert history["metrics"]["total_trades"] == detail.total_trades
        assert history["metrics"]["profit_factor"] == detail.profit_factor
        assert history["backtest_id"] == detail.backtest_id


class TestGetBacktest:
    @pytest.mark.asyncio
    async def test_hit_round_trips_persisted_bytes(self):
        svc = make_servicer()
        stored = analysis_pb2.BacktestResult(
            backtest_id="bt-1",
            strategy_id="s1",
            total_return=0.12,
            total_trades=3,
            initial_capital=100_000.0,
            status=analysis_pb2.BACKTEST_STATUS_OK,
        )
        svc._backtest_details_repo = AsyncMock()
        svc._backtest_details_repo.get = AsyncMock(return_value=stored.SerializeToString())

        req = MagicMock()
        req.backtest_id = "bt-1"
        result = await svc.GetBacktest(req, context=MagicMock())

        assert result == stored  # byte-exact round trip
        svc._backtest_details_repo.get.assert_awaited_once_with("bt-1")

    @pytest.mark.asyncio
    async def test_miss_aborts_not_found(self):
        svc = make_servicer()
        svc._backtest_details_repo = AsyncMock()
        svc._backtest_details_repo.get = AsyncMock(return_value=None)
        req = MagicMock()
        req.backtest_id = "bt-legacy"
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(req, context)

        context.abort.assert_awaited_once()
        code, msg = context.abort.await_args.args
        assert code == grpc.StatusCode.NOT_FOUND
        assert msg == "no detailed data for this run"

    @pytest.mark.asyncio
    async def test_no_db_path_aborts_not_found(self):
        """Repo None (no DB) degrades to the same single FR-6 NOT_FOUND state."""
        svc = make_servicer()  # repos None by default
        req = MagicMock()
        req.backtest_id = "bt-1"
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(req, context)

        code, msg = context.abort.await_args.args
        assert code == grpc.StatusCode.NOT_FOUND
        assert msg == "no detailed data for this run"

    @pytest.mark.asyncio
    async def test_read_error_aborts_not_found(self):
        """A DB read error logs a warning and aborts NOT_FOUND (never a 500 leak)."""
        svc = make_servicer()
        svc._backtest_details_repo = AsyncMock()
        svc._backtest_details_repo.get = AsyncMock(side_effect=RuntimeError("db down"))
        req = MagicMock()
        req.backtest_id = "bt-1"
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(req, context)

        code, msg = context.abort.await_args.args
        assert code == grpc.StatusCode.NOT_FOUND
        assert msg == "no detailed data for this run"


# ---------------------------------------------------------------------------
# Re-entry cooldown — backtest gate (feature 069, FR-7 / FR-6 / FR-9)
# ---------------------------------------------------------------------------


def _cooldown_bar(close, day):
    """A real marketdata Bar with a daily-incrementing tz-aware timestamp."""
    from gen.marketdata.v1 import marketdata_pb2

    bar = marketdata_pb2.Bar(
        symbol="AAPL", open=close, high=close, low=close, close=close, volume=1000, vwap=close
    )
    bar.time.FromSeconds(1_700_000_000 + day * 86_400)
    return bar


async def _run_evaluated(svc, definition, decisions, n_bars):
    """Drive _backtest_symbol_evaluated with a controlled decisions sequence.

    Patches StrategyEvaluator so entry/exit are exactly ``decisions`` (length ``n_bars``),
    and feeds daily bars so the cooldown's calendar-day math is exercised via bar.time.
    """
    from types import SimpleNamespace
    from unittest.mock import patch

    from gen.common.v1 import common_pb2

    bars = [_cooldown_bar(100.0, i) for i in range(n_bars)]
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
    svc._compute_evaluated_warmup = AsyncMock(return_value=0)
    fake_eval = MagicMock()
    fake_eval.evaluate_with_series = AsyncMock(return_value=(decisions, {}))
    with patch("app.handlers.servicer.StrategyEvaluator", return_value=fake_eval):
        return await svc._backtest_symbol_evaluated(
            "AAPL", common_pb2.TimeRange(), definition, 100_000.0, 0.0, 0.0
        )


def _decisions(n, entries=(), exits=()):
    from app.services.evaluator import BarDecision

    ds = [BarDecision(bar_index=i, entry=False, exit=False, conviction=0.0) for i in range(n)]
    for i in entries:
        ds[i].entry = True
        ds[i].conviction = 1.0
    for i in exits:
        ds[i].exit = True
    return ds


class TestBacktestCooldown:
    @pytest.mark.asyncio
    async def test_whipsaw_reentry_suppressed_by_default_cooldown(self):
        """AC-3: entry refiring on the bar right after an exit is suppressed by the default."""
        svc = make_servicer()
        # entry@1, exit@2, entry@3 (immediate re-entry attempt), nothing else.
        decisions = _decisions(40, entries=(1, 3), exits=(2,))
        definition = _valid_definition()  # cooldown_days unset → default 31
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        # Only the first trade (entry@1 → exit@2); the day-3 re-entry is gated, so no open
        # position remains to be force-closed at the last bar.
        assert len(trades) == 1

    @pytest.mark.asyncio
    async def test_explicit_zero_cooldown_allows_immediate_reentry(self):
        """Explicit cooldown_days=0 → immediate re-entry allowed (no gate)."""
        svc = make_servicer()
        decisions = _decisions(40, entries=(1, 3), exits=(2,))
        definition = _valid_definition()
        definition.cooldown_days = 0
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        # entry@1→exit@2 (trade 1) then entry@3 re-enters, held open, force-closed at last bar.
        assert len(trades) == 2

    @pytest.mark.asyncio
    async def test_reentry_allowed_after_window_elapses(self):
        """After the cooldown's calendar days pass, a later entry is allowed again."""
        svc = make_servicer()
        # entry@1, exit@2 (day 2), entry@3 (gated), entry@35 (day 35 > day2+31 → allowed).
        decisions = _decisions(40, entries=(1, 3, 35), exits=(2,))
        definition = _valid_definition()  # default 31
        trades, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        assert len(trades) == 2  # first trade + the post-window re-entry (open→force-closed)

    @pytest.mark.asyncio
    async def test_backtest_reproducible_across_runs(self):
        """AC-8 (FR-7): two runs of the same strategy/symbol produce identical trades.

        Cooldown state is a per-call local, never a shared/persisted store, so runs cannot
        cross-contaminate.
        """
        svc = make_servicer()
        decisions = _decisions(40, entries=(1, 3, 35), exits=(2,))
        definition = _valid_definition()
        t1, _, _, _ = await _run_evaluated(svc, definition, decisions, 40)
        t2, _, _, _ = await _run_evaluated(
            svc, _valid_definition(), _decisions(40, (1, 3, 35), (2,)), 40
        )
        assert len(t1) == len(t2)
        assert [(round(t.pnl, 6), t.entry_time.seconds) for t in t1] == [
            (round(t.pnl, 6), t.entry_time.seconds) for t in t2
        ]

    def test_fingerprint_changes_with_cooldown_days(self):
        """AC-9 (FR-9): differing cooldown_days yield different fingerprints."""
        from app.handlers.servicer import _definition_fingerprint

        base = {"entry_rule": "x"}
        assert _definition_fingerprint(base) != _definition_fingerprint(
            {**base, "cooldown_days": 14}
        )

    @pytest.mark.asyncio
    async def test_manage_strategy_rejects_negative_cooldown(self):
        """AC-1: ManageStrategy register aborts INVALID_ARGUMENT on a negative cooldown."""
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(_valid_definition()))
        definition = _valid_definition()
        definition.cooldown_days = -1
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, ctx)
        code, _ = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT

    @pytest.mark.asyncio
    async def test_manage_strategy_accepts_zero_cooldown(self):
        """Explicit cooldown_days=0 passes write-time validation (register proceeds)."""
        svc = make_servicer()
        definition = _valid_definition()
        definition.cooldown_days = 0
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)  # feature 089: not existing
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())
        assert result.strategy_id == "sma_x"


# ---------------------------------------------------------------------------
# feature 070 — partial strategy update (update_mask)
# ---------------------------------------------------------------------------


def _stored_row(strategy_id="s1", cooldown=None):
    """A fully-populated stored strategy — the thing the incident wiped."""
    definition = analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name="Range MR v3",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="z",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 20.0},
            )
        ],
        entry_rule=json.dumps({"fn": "<", "lhs": "z", "rhs": -1.0}),
        exit_rule=json.dumps({"fn": ">", "lhs": "z", "rhs": 1.0}),
    )
    if cooldown is not None:
        definition.cooldown_days = cooldown
    return {
        "strategy_id": strategy_id,
        "display_name": definition.display_name,
        "active": True,
        "live_enabled": False,
        "definition_json": json_format.MessageToDict(definition, preserving_proto_field_name=True),
    }


def _masked_req(strategy_id="s1", paths=(), **fields):
    definition = analysis_pb2.StrategyDefinition(strategy_id=strategy_id, **fields)
    req = analysis_pb2.ManageStrategyRequest(
        operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=definition
    )
    req.update_mask.paths.extend(paths)
    return req


class TestPartialStrategyUpdate:
    """The reported incident: `manage_strategy update` with only cooldown_days wiped the
    strategy's components and rules. These pin the server half of the fix."""

    @pytest.mark.asyncio
    async def test_cooldown_only_update_preserves_components_and_rules(self):
        """AC-1 at the servicer layer — the exact shape that caused the incident."""
        svc = make_servicer()
        stored = _stored_row()
        repo = _stub_update_repo(svc, stored)

        req = _masked_req(paths=["cooldown_days"], cooldown_days=45)
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.cooldown_days == 45
        # The whole point: nothing else moved.
        assert [c.ref_name for c in result.components] == ["z"]
        assert result.components[0].indicator == "SMA"
        assert json.loads(result.entry_rule) == {"fn": "<", "lhs": "z", "rhs": -1.0}
        assert json.loads(result.exit_rule) == {"fn": ">", "lhs": "z", "rhs": 1.0}
        assert result.display_name == "Range MR v3"  # not blanked
        repo.update_locked.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_masked_rename_applies_without_touching_the_definition(self):
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())

        req = _masked_req(paths=["display_name"], display_name="Renamed")
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.display_name == "Renamed"
        assert [c.ref_name for c in result.components] == ["z"]

    @pytest.mark.asyncio
    async def test_masked_but_absent_path_clears_the_field(self):
        """AIP-161: a masked path with no value in the request is an explicit erase. This is
        the only way to express 'clear', since proto3 gives these fields no presence."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())

        req = _masked_req(paths=["exit_rule"])  # exit_rule deliberately not supplied
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.exit_rule == ""
        assert json.loads(result.entry_rule)["lhs"] == "z"  # untouched

    @pytest.mark.asyncio
    async def test_cooldown_days_can_be_cleared_back_to_platform_default(self):
        """The inverse of the feature-069 explicit-presence trap: an explicit 0 must be
        settable AND revertible to unset. Masking without supplying does the revert."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row(cooldown=0))

        result = await svc.ManageStrategy(
            _masked_req(paths=["cooldown_days"]), context=_admin_ctx()
        )
        assert not result.HasField("cooldown_days")

    @pytest.mark.asyncio
    async def test_maskless_update_is_still_a_full_replace(self):
        """FR-5 / AC-6 regression guard: absent mask keeps pre-070 semantics, so the
        StrategyWizard (which always sends a complete definition) needs no change."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        replacement = _valid_definition(display_name="Wholly New")
        # Carry an exit_rule: the stored strategy has one, and the erasure guard applies to
        # maskless UPDATE too (see test_maskless_replace_cannot_silently_drop_a_rule).
        replacement.exit_rule = json.dumps({"fn": ">", "lhs": "fast", "rhs": 200})

        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=replacement
        )
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert result.display_name == "Wholly New"
        assert [c.ref_name for c in result.components] == ["fast"]  # old 'z' gone
        assert json.loads(result.exit_rule)["rhs"] == 200

    @pytest.mark.asyncio
    async def test_maskless_replace_cannot_silently_drop_a_rule(self):
        """A deliberate, documented narrowing of the pre-070 contract.

        A maskless full replace that omits a rule the stored strategy HAS is now rejected —
        the guard cannot tell that apart from the incident. The StrategyWizard never trips it
        (its step gates require non-blank rules before submit), but a raw grpcurl/ops caller
        that legitimately wants to drop a rule must now say so via update_mask."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        replacement = _valid_definition(display_name="No Exit")  # no exit_rule
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=replacement
        )
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context=ctx)

        code, msg = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT
        assert "refusing to blank 'exit_rule'" in msg

    @pytest.mark.asyncio
    async def test_maskless_wipe_is_rejected_even_from_an_unpatched_client(self):
        """FR-2b, fail-closed. This is the incident replayed byte-for-byte: an empty
        definition carrying only cooldown_days, no mask. The server alone must stop it."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        bare = analysis_pb2.StrategyDefinition(strategy_id="s1")
        bare.cooldown_days = 45
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=bare
        )
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context=ctx)

        code, msg = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT
        assert "refusing to clear 'components'" in msg
        assert "update_mask" in msg  # names the escape hatch

    @pytest.mark.asyncio
    async def test_explicitly_masked_erasure_is_allowed(self):
        """The guard must not block a deliberate clear — only an accidental one."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())

        req = _masked_req(paths=["components", "entry_rule", "exit_rule"])
        result = await svc.ManageStrategy(req, context=_admin_ctx())

        assert list(result.components) == []
        assert result.entry_rule == ""

    @pytest.mark.asyncio
    async def test_merged_result_is_validated_not_just_the_request(self):
        """FR-2a: swapping components out from under a stored rule must be caught. The
        request alone looks fine — only the MERGED definition is orphaned."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        # Replace 'z' with 'q'; the stored entry_rule still references 'z'.
        req = _masked_req(
            paths=["components"],
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="q",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="SMA",
                    params={"period": 5.0},
                )
            ],
        )
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context=ctx)

        code, msg = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT
        assert "not defined as a component ref_name" in msg

    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", ["strategy_id", "active", "live_enabled"])
    async def test_column_authoritative_paths_are_rejected(self, path):
        """Masking these would write a value the next read silently discards."""
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(_masked_req(paths=[path]), context=ctx)

        code, msg = ctx.abort.await_args.args
        assert code == grpc.StatusCode.INVALID_ARGUMENT
        assert "column-authoritative" in msg

    @pytest.mark.asyncio
    async def test_unknown_mask_path_is_rejected(self):
        svc = make_servicer()
        _stub_update_repo(svc, _stored_row())
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(_masked_req(paths=["nope"]), context=ctx)

        assert "unknown update_mask path" in ctx.abort.await_args.args[1]

    @pytest.mark.asyncio
    async def test_missing_strategy_is_not_found_before_any_write(self):
        svc = make_servicer()
        repo = AsyncMock()
        repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo = repo
        ctx = _abort_ctx()
        svc._has_admin_scope = lambda c: True

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(_masked_req(paths=["display_name"]), context=ctx)

        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND
        repo.update_locked.assert_not_awaited()  # no write attempted


# ---------------------------------------------------------------------------
# feature 071 step 3 — trade_start_idx plumbing
# ---------------------------------------------------------------------------


class TestTradeStartIndex:
    """feature 071 — the pre-window prefix seeds indicators without becoming tradeable.

    `trade_start_idx` is DERIVED inside the engine by `_resolve_prefixed_bars`, so these drive
    the real path: bars that predate `range_msg.start` are the prefix, and `warmup_prefix=True`
    (set when the caller supplied an explicit start) turns the mechanism on.

    The invariant under test is `len(daily_equity) == len(diags)`, which
    `_finalize_symbol_diagnostics` stamps positionally and now asserts.
    """

    WINDOW_START = 1_000_000

    def _svc(self, bars, fast_series, slow_series):
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=[_points(fast_series), _points(slow_series)]
        )
        return svc

    def _bars(self, n_prefix, n_window):
        """n_prefix bars before WINDOW_START, then n_window at/after it (1 day apart)."""
        day = 86_400
        out = []
        for i in range(n_prefix):
            out.append(_bar(self.WINDOW_START - (n_prefix - i) * day, 10 + i))
        for i in range(n_window):
            out.append(_bar(self.WINDOW_START + i * day, 20 + i))
        return out

    async def _run(self, n_prefix, n_window, *, warmup_prefix=True, slow=3):
        bars = self._bars(n_prefix, n_window)
        total = len(bars)
        svc = self._svc(bars, [9] * (total - 1), [11] * (total - 2))
        rng = common_pb2.TimeRange()
        rng.start.seconds = self.WINDOW_START
        rng.end.seconds = self.WINDOW_START + 10 * 86_400
        return await svc._backtest_symbol(
            "AAPL",
            rng,
            fast_period=2,
            slow_period=slow,
            signal_sources=[],
            signal_weight=0.0,
            technical_weight=1.0,
            min_conviction=0.0,
            initial_equity=100_000.0,
            commission=0.0,
            slippage=0.0,
            source_weights={},
            warmup_prefix=warmup_prefix,
        )

    @pytest.mark.asyncio
    async def test_without_prefix_every_bar_is_in_scope(self):
        """warmup_prefix=False is the default/rolling path — unchanged pre-071 behavior."""
        _, _, daily_equity, sd = await self._run(0, 8, warmup_prefix=False)
        assert sd.bars_total == 8
        assert len(daily_equity) == len(sd.bars) == 8
        assert [b.bar_index for b in sd.bars][:3] == [0, 1, 2]

    @pytest.mark.asyncio
    async def test_prefix_bars_are_excluded_and_indices_renumbered(self):
        """slow_period=3 → 3 prefix bars required and consumed; only the window is reported."""
        _, _, daily_equity, sd = await self._run(3, 6)
        assert sd.bars_total == 6
        assert [b.bar_index for b in sd.bars] == list(range(6))
        assert len(daily_equity) == len(sd.bars)

    @pytest.mark.asyncio
    async def test_first_in_window_bar_keeps_its_real_timestamp(self):
        """Renumbering bar_index must not renumber time — the prefix is dropped, not shifted."""
        _, _, _, sd = await self._run(3, 6)
        assert sd.bars[0].bar_index == 0
        assert sd.bars[0].timestamp.seconds == self.WINDOW_START

    @pytest.mark.asyncio
    async def test_nothing_before_the_window_is_traded_or_reported(self):
        """FR-3: the prefix seeds indicators; it must never produce a trade or a diag row."""
        trades, _, _, sd = await self._run(3, 6)
        for t in trades:
            assert t.entry_time.seconds >= self.WINDOW_START
        for bar in sd.bars:
            assert bar.timestamp.seconds >= self.WINDOW_START

    @pytest.mark.asyncio
    async def test_surplus_prefix_is_discarded_deterministically(self):
        """Over-fetching is harmless: the engine keeps exactly the required prefix, which is
        what makes the bars→calendar-days conversion sizing-only rather than semantic."""
        _, _, _, sd_exact = await self._run(3, 6)
        _, _, _, sd_surplus = await self._run(9, 6)  # far more prefix than needed
        assert sd_exact.bars_total == sd_surplus.bars_total == 6
        assert [b.timestamp.seconds for b in sd_exact.bars] == [
            b.timestamp.seconds for b in sd_surplus.bars
        ]

    @pytest.mark.asyncio
    async def test_insufficient_prefix_reports_a_shortfall(self):
        """AC-4a / OQ-1: a clear error beats silently running short-warmed."""
        with pytest.raises(_InsufficientData) as ei:
            await self._run(1, 6)  # needs 3 prefix bars, only 1 available
        assert ei.value.bars_have == 1
        assert ei.value.bars_need == 3
        # The actionable backfill span is the PREFIX, not the caller's window.
        assert ei.value.gap_range is not None
        assert ei.value.gap_range.end.seconds == self.WINDOW_START


# ---------------------------------------------------------------------------
# feature 071 step 6 — parity & determinism
# ---------------------------------------------------------------------------

_DAY = 86_400
_W_START = 1_600_000_000  # a fixed, explicit window start used across this section
_W_END = _W_START + 30 * _DAY


def _windowed_req(definition, *, start=_W_START, end=_W_END, symbols=("AAPL",)):
    req = analysis_pb2.RunBacktestRequest(
        strategy_id="s1", symbols=list(symbols), initial_capital=100_000.0
    )
    req.inline_definition.CopyFrom(definition)
    req.range.start.seconds = start
    req.range.end.seconds = end
    return req


def _sma_def(period=3, ref="fast"):
    return analysis_pb2.StrategyDefinition(
        components=[
            analysis_pb2.StrategyComponent(
                ref_name=ref,
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": float(period)},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": ref, "rhs": 0}),
        exit_rule=json.dumps({"fn": "<", "lhs": ref, "rhs": 0}),
    )


def _series_bars(n_prefix, n_window, base=100.0):
    """n_prefix bars before _W_START then n_window from _W_START, 1 day apart.

    The close is a pure function of the bar's date, so lengthening the prefix prepends
    earlier bars without altering any bar the two fixtures share. Deriving it from the list
    index instead would make a longer prefix silently restate the whole series, and a test
    comparing two prefix lengths would be comparing two different price histories.
    """
    return [_bar(_W_START + off * _DAY, base + off) for off in range(-n_prefix, n_window)]


def _canonical(result):
    """Serialize a BacktestResult with its two inherently per-run fields cleared.

    `backtest_id` is a fresh uuid and `completed_at` is a wall-clock stamp — both differ on
    every run by construction, so leaving them in would make any byte-identity assertion
    vacuously false and tempt a weaker field-by-field comparison instead.
    """
    copy = analysis_pb2.BacktestResult()
    copy.CopyFrom(result)
    copy.backtest_id = ""
    copy.ClearField("completed_at")
    return copy.SerializeToString(deterministic=True)


def _wire_evaluated(svc, bars, *, capture=None):
    """Wire a servicer whose evaluator sees a real, length-n series per component.

    ComputeIndicator is mocked but *length-faithful*: it returns one point per input value,
    so the evaluator's tail-alignment is exercised and `capture` records exactly how many
    bars each component was computed over — which is the observable the anchor/cost tests
    are actually about.
    """
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    svc._backtest_run_symbols_repo = AsyncMock()
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
    svc._indicators = MagicMock()

    async def _compute(req, **kw):
        if capture is not None:
            capture.append((req.indicator, len(req.values)))
        # Monotone ramp so decisions are deterministic and non-trivial.
        return _points([float(i) for i in range(len(req.values))])

    svc._indicators.ComputeIndicator = AsyncMock(side_effect=_compute)
    return svc


class TestWindowDeterminism:
    """FR-4 — a run over an explicit window must not depend on the calendar day."""

    @staticmethod
    def _freeze(seconds):
        """Freeze the servicer's only wall-clock read (`Timestamp.GetCurrentTime`)."""

        def _set(self):
            self.seconds = seconds
            self.nanos = 0

        return patch.object(Timestamp, "GetCurrentTime", _set)

    @pytest.mark.asyncio
    async def test_explicit_window_is_identical_across_calendar_days(self):
        bars = _series_bars(6, 12)

        async def _run(now_seconds):
            svc = _wire_evaluated(make_servicer(), bars)
            with self._freeze(now_seconds):
                return await svc.RunBacktest(_windowed_req(_sma_def()), context=MagicMock())

        # "today" a full year apart
        day_one = await _run(_W_END + _DAY)
        day_later = await _run(_W_END + 365 * _DAY)
        assert _canonical(day_one) == _canonical(day_later)

    @pytest.mark.asyncio
    async def test_the_frozen_clock_test_has_teeth(self):
        """Guards the test above: without an explicit window the clock DOES move the result,
        so equality there is evidence of the window, not of an inert clock patch."""
        captured = []

        async def _effective_window(now_seconds):
            svc = _wire_evaluated(make_servicer(), _series_bars(0, 12))
            req = analysis_pb2.RunBacktestRequest(
                strategy_id="s1", symbols=["AAPL"], initial_capital=100_000.0
            )
            req.inline_definition.CopyFrom(_sma_def())
            req.range.CopyFrom(common_pb2.TimeRange())  # no bounds → rolling default
            with self._freeze(now_seconds):
                await svc.RunBacktest(req, context=MagicMock())
            captured.append((req.range.start.seconds, req.range.end.seconds))

        await _effective_window(_W_END + _DAY)
        await _effective_window(_W_END + 365 * _DAY)
        assert captured[0] != captured[1]

    @pytest.mark.asyncio
    async def test_no_trade_opens_before_the_requested_start(self):
        """FR-3 at the RPC level: the prefix seeds indicators only."""
        svc = _wire_evaluated(make_servicer(), _series_bars(6, 12))
        result = await svc.RunBacktest(_windowed_req(_sma_def()), context=MagicMock())
        assert result.trades  # the assertion below is vacuous on an empty list
        assert all(t.entry_time.seconds >= _W_START for t in result.trades)
        assert all(b.timestamp.seconds >= _W_START for b in result.diagnostics[0].bars)


class TestPrefixSizingIsNotSemantic:
    """The bars→calendar-days conversion may only over-fetch, never change a result."""

    @pytest.mark.asyncio
    async def test_doubling_the_calendar_factor_is_byte_identical(self):
        """`prefix_calendar_days` widens the *fetch*; the engine then keeps exactly the
        required bars. Doubling its slack must therefore change nothing observable — that is
        what licenses the conversion to be approximate (F-07: no hidden tuned constant)."""
        bars = _series_bars(30, 12)  # generous history so a wider fetch is satisfiable

        async def _run():
            svc = _wire_evaluated(make_servicer(), bars)
            return await svc.RunBacktest(_windowed_req(_sma_def()), context=MagicMock())

        baseline = await _run()
        with patch.object(
            warmup_sizing, "_CALENDAR_SLACK_DAYS", warmup_sizing._CALENDAR_SLACK_DAYS * 2
        ):
            doubled = await _run()
        assert _canonical(baseline) == _canonical(doubled)

    @pytest.mark.asyncio
    async def test_surplus_history_beyond_the_prefix_is_ignored(self):
        """Same claim from the other side: more available history than the prefix needs must
        not shift the anchor. Otherwise a symbol's result would depend on how far back
        marketdata happens to hold data."""

        async def _run(n_prefix):
            svc = _wire_evaluated(make_servicer(), _series_bars(n_prefix, 12))
            return await svc.RunBacktest(_windowed_req(_sma_def()), context=MagicMock())

        assert _canonical(await _run(6)) == _canonical(await _run(40))


class TestVwapAnchorMovesWithPrefix:
    """Documented behavior change — VWAP is an expanding average anchored at index 0.

    Its own lookback is 0, but the prefix is the max over *all* referenced components, so a
    strategy mixing VWAP with a long SMA gets a prefix anyway and every in-window VWAP value
    shifts: the anchor moves from the requested start to the prefix start. Deterministic
    (FR-4 still holds), but different from an unprefixed run.
    """

    def _def(self):
        return analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="vw",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="VWAP",
                ),
                analysis_pb2.StrategyComponent(
                    ref_name="slow",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="SMA",
                    params={"period": 50.0},
                ),
            ],
            entry_rule=json.dumps(
                {"op": "AND", "conditions": [{"fn": ">", "lhs": "vw", "rhs": "slow"}]}
            ),
        )

    def test_vwap_alone_asks_for_no_prefix(self):
        vwap_only = analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="vw",
                    kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                    indicator="VWAP",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "vw", "rhs": 0}),
        )
        assert warmup_sizing.required_prefix_bars(vwap_only) == 0

    def test_a_long_sibling_drags_vwap_into_a_prefix(self):
        # SMA(50) is first valid at index 49 and usable at 50 (crossover reads i-1).
        assert warmup_sizing.required_prefix_bars(self._def()) == 50

    @pytest.mark.asyncio
    async def test_vwap_is_computed_over_the_prefixed_series(self):
        """The anchor shift, pinned at its cause: VWAP receives prefix+window closes, so its
        cumulative mean starts 50 bars earlier than the caller's window."""
        capture = []
        svc = _wire_evaluated(make_servicer(), _series_bars(50, 12), capture=capture)
        await svc.RunBacktest(_windowed_req(self._def()), context=MagicMock())
        by_indicator = dict(capture)
        assert by_indicator["VWAP"] == 62  # 50 prefix + 12 window, not 12
        assert by_indicator["SMA"] == 62


class TestBacktestLiveParityUnchanged:
    """FR-7 / OQ-4 — 071 is a backtest-path change; the live loop is deliberately untouched.

    The real parity invariant is the evaluator contract — *same bar series ⇒ same decisions*.
    That still holds exactly. What now differs between the two callers is the series each one
    supplies, and that difference must stay visible rather than be quietly assumed away.
    """

    def test_the_live_loop_still_uses_its_own_fixed_lookback(self):
        """If someone later wires the prefix into the live loop, this fails and the FR-7
        divergence documented in the service CLAUDE.md has to be revisited."""
        from app.engine import live_loop

        assert live_loop._LOOKBACK_DAYS == 365
        source = Path(live_loop.__file__).read_text()
        assert "warmup" not in source, (
            "live_loop now references the warm-up prefix — FR-7's documented divergence "
            "(design.md § OQ-4) is stale and the parity note must be updated"
        )

    def test_the_evaluator_contract_takes_no_window_argument(self):
        """The prefix lives entirely in the servicer's fetch. The evaluator receives a plain
        bar list, so it cannot behave differently for a backtest than for the live loop."""
        from app.services.evaluator import StrategyEvaluator

        params = inspect.signature(StrategyEvaluator.evaluate).parameters
        assert "range" not in params
        assert "trade_start_idx" not in params
        assert "warmup_prefix" not in params


class TestPrefixFormulaCost:
    """The prefix is paid for in bars sent to ExecuteFormula — measured, not assumed."""

    def _def(self):
        return analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="ff",
                    kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                    formula_id="f-1",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "ff", "rhs": 0}),
        )

    @pytest.mark.asyncio
    async def _run(self, declared_warmup, n_prefix, n_window):
        from google.protobuf.struct_pb2 import Struct

        bars = _series_bars(n_prefix, n_window)
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_run_symbols_repo = AsyncMock()
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        sizes = []

        async def _execute(req, **kw):
            # The evaluator passes the close series in input_data (evaluator.py:193-194).
            n = len(req.input_data["close"])
            sizes.append(n)
            out = Struct()
            out.update({"value": [1.0] * n})
            return SimpleNamespace(success=True, output=out, error="")

        svc._indicators.ExecuteFormula = AsyncMock(side_effect=_execute)
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="f-1", warmup_period=declared_warmup
            )
        )
        await svc.RunBacktest(_windowed_req(self._def()), context=MagicMock())
        return sizes

    @pytest.mark.asyncio
    async def test_a_declared_warmup_costs_exactly_its_prefix(self):
        """A formula declaring warmup_period=W is evaluated over W+1 extra bars (the +1 is the
        crossover lookback), so the cost of the prefix is bounded by the declaration — not by
        an open-ended "fetch more to be safe"."""
        sizes = await self._run(declared_warmup=10, n_prefix=20, n_window=12)
        assert sizes == [11 + 12]

    @pytest.mark.asyncio
    async def test_a_zero_warmup_formula_costs_nothing_extra(self):
        """A formula that declares no warm-up must not be silently charged a prefix.

        n_prefix=0 because the GetBars mock ignores `range`: with no prefix requested the
        fetch is unfiltered, so any pre-window bars in the fixture would reach the engine and
        make this measure the fixture instead of the code.
        """
        sizes = await self._run(declared_warmup=0, n_prefix=0, n_window=12)
        assert sizes == [12]

    @pytest.mark.asyncio
    async def test_every_symbol_pays_the_same_prefix(self):
        """Regression: the declared warm-ups must be resolved BEFORE the symbol loop.

        `required_prefix_bars` reads the formula cache at the top of each symbol's run while
        `_compute_evaluated_warmup` fills it at the bottom, so a lazily-filled cache gave
        symbol 1 no prefix and symbols 2+ the full one — a result that depends on symbol order.
        """
        from google.protobuf.struct_pb2 import Struct

        bars = _series_bars(20, 12)
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_run_symbols_repo = AsyncMock()
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()
        sizes = []

        async def _execute(req, **kw):
            n = len(req.input_data["close"])
            sizes.append(n)
            out = Struct()
            out.update({"value": [1.0] * n})
            return SimpleNamespace(success=True, output=out, error="")

        svc._indicators.ExecuteFormula = AsyncMock(side_effect=_execute)
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="f-1", warmup_period=10)
        )
        await svc.RunBacktest(
            _windowed_req(self._def(), symbols=("AAPL", "MSFT")), context=MagicMock()
        )
        assert sizes == [23, 23]
        # ...and the declaration is fetched once for the whole run, not once per symbol.
        assert svc._indicators.GetFormula.await_count == 1


# ---------------------------------------------------------------------------
# EvaluateReadiness + ListOpportunities (feature 083)
# ---------------------------------------------------------------------------


def _ctx(headers):
    """A gRPC context whose invocation_metadata replays the given headers."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=list(headers.items()))
    ctx.abort = AsyncMock()
    return ctx


_HEADERS = {"x-user-id": "u1", "x-access-scope": "7", "x-trace-id": "t1"}


def _bars_resp(closes):
    """A GetBars page: one bar per close with a monotonic time cursor, no next page."""
    resp = MagicMock()
    bars = []
    for i, c in enumerate(closes):
        b = MagicMock()
        b.close = c
        b.time.seconds = 1_700_000_000 + i * 86_400
        b.time.nanos = 0
        bars.append(b)
    resp.bars = bars
    resp.page.next_page_token = ""
    return resp


def _strategy_row_single_gt(threshold=100.0):
    """A strategy row whose entry_rule is a single `sma > threshold` leaf (SMA≈close)."""
    definition = analysis_pb2.StrategyDefinition(
        strategy_id="s1",
        display_name="S1",
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="sma",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 3.0},
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "sma", "rhs": threshold}),
    )
    return {
        "strategy_id": "s1",
        "display_name": "S1",
        "active": True,
        "live_enabled": True,
        "definition_json": json_format.MessageToDict(definition),
    }


class TestEvaluateReadiness:
    def _svc(self, bars_by_symbol):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_strategy_row_single_gt())
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(
            side_effect=lambda req, metadata=None: _bars_resp(bars_by_symbol[req.symbol])
        )
        # SMA ≈ close: return one point per close, value == close.
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            side_effect=lambda req, metadata=None: SimpleNamespace(
                result=[SimpleNamespace(value=v, extra={}) for v in req.values]
            )
        )
        return svc

    @pytest.mark.asyncio
    async def test_firing_symbol_passes_high_conviction(self):
        svc = self._svc({"AAPL": [120.0, 130.0, 150.0]})
        resp = await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
            _ctx(_HEADERS),
        )
        r = resp.readiness[0]
        assert r.symbol == "AAPL"
        assert r.passing_conditions == 1 and r.total_conditions == 1
        assert r.conviction == 1.0
        assert r.conditions[0].state == analysis_pb2.CONDITION_STATE_PASS

    @pytest.mark.asyncio
    async def test_near_symbol_soft_with_distance(self):
        # last SMA 98 vs threshold 100 → within the 5% soft-band → SOFT, distance < 0.
        svc = self._svc({"AAPL": [95.0, 97.0, 98.0]})
        resp = await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
            _ctx(_HEADERS),
        )
        r = resp.readiness[0]
        assert r.passing_conditions == 0
        assert r.conditions[0].state == analysis_pb2.CONDITION_STATE_SOFT
        assert r.conditions[0].distance_to_threshold < 0
        assert 0.0 < r.conviction < 1.0

    @pytest.mark.asyncio
    async def test_headers_reach_marketdata_and_indicators(self):
        svc = self._svc({"AAPL": [120.0, 130.0, 150.0]})
        await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="s1", symbols=["AAPL"]),
            _ctx(_HEADERS),
        )
        md_meta = dict(svc._marketdata.GetBars.await_args.kwargs["metadata"])
        ind_meta = dict(svc._indicators.ComputeIndicator.await_args.kwargs["metadata"])
        for meta in (md_meta, ind_meta):
            assert meta["x-user-id"] == "u1"
            assert meta["x-access-scope"] == "7"
            assert meta["x-trace-id"] == "t1"

    @pytest.mark.asyncio
    async def test_unknown_strategy_aborts_not_found(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        ctx = _ctx(_HEADERS)
        await svc.EvaluateReadiness(
            analysis_pb2.EvaluateReadinessRequest(strategy_id="nope", symbols=["AAPL"]), ctx
        )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND


def _sig(symbol, direction, conviction, source="src"):
    return ingest_pb2.ExternalSignal(
        symbol=symbol,
        direction=direction,
        conviction=conviction,
        source=source,
        headline=f"{direction} {symbol}",
    )


# ── Materialized opportunity Universe (feature 097) ─────────────────────────────


class _FakeOppRepo:
    """In-memory stand-in for OpportunitiesRepository so the real ``_compute_opportunities``
    Universe logic runs end-to-end (no DB). ``replace_for_user`` stores the compute's row dicts
    verbatim; ``read`` re-applies the valid/action filter + rank the SQL would, so the assertions
    exercise the producer path, not a re-implementation of it."""

    def __init__(self):
        self.rows: dict[str, list[dict]] = {}
        self.actions: dict[tuple[str, str], dict] = {}  # (user, key) -> {action, snooze_until}

    async def replace_for_user(self, user_id, rows):
        self.rows[user_id] = [dict(r) for r in rows]

    async def count_for_user(self, user_id):
        return len(self.rows.get(user_id, []))

    async def has_fresh(self, user_id):
        now = datetime.now(UTC)
        return any(r["valid_until"] > now for r in self.rows.get(user_id, []))

    async def read(self, user_id, min_conviction, w, *, include_expired):
        now = datetime.now(UTC)
        ww = min(max(w, 0.0), 1.0)
        out = []
        for r in self.rows.get(user_id, []):
            if not include_expired and r["valid_until"] <= now:
                continue
            if r["conviction"] < min_conviction:
                continue
            act = self.actions.get((user_id, r["opportunity_key"]))
            if act:
                if act["action"] == 2:  # DISMISS
                    continue
                if act["action"] == 1 and act.get("snooze_until") and act["snooze_until"] > now:
                    continue
            out.append(r)
        out.sort(key=lambda r: (1 - ww) * r["conviction"] + ww * r["signal_axis"], reverse=True)
        return out

    async def distinct_user_ids(self):
        return list(self.rows.keys())

    async def queue_share(self, user_id, strategy_id):
        now = datetime.now(UTC)
        rows = [r for r in self.rows.get(user_id, []) if r["valid_until"] > now]
        denom = sum(1 for r in rows if r["strategy_id"])
        if denom == 0:
            return 0.0
        return sum(1 for r in rows if r["strategy_id"] == strategy_id) / denom

    async def taken_count(self, user_id, strategy_id):
        c = 0
        for (uid, key), act in self.actions.items():
            if uid == user_id and act["action"] == 3:  # TAKE
                row = next(
                    (r for r in self.rows.get(user_id, []) if r["opportunity_key"] == key), None
                )
                if row and row["strategy_id"] == strategy_id:
                    c += 1
        return c


def _recent_bars_resp(closes):
    """A GetBars page whose newest bar is stamped ~now, one bar per close going back a day each.

    The materialized queue's ``valid_until`` = the compute's session date (newest fetched bar) +
    the valid window, so the fixture's last bar must be recent or every row reads as already
    expired. (``_bars_resp`` uses a fixed 2023 base, fine where validity is irrelevant.)"""
    resp = MagicMock()
    n = len(closes)
    now_s = int(datetime.now(UTC).timestamp())
    bars = []
    for i, c in enumerate(closes):
        b = MagicMock()
        b.close = c
        b.time.seconds = now_s - (n - 1 - i) * 86_400
        b.time.nanos = 0
        bars.append(b)
    resp.bars = bars
    resp.page.next_page_token = ""
    return resp


def _wl(bindings=None, symbols=None):
    """A Watchlist-shaped object: ``bindings`` = [(symbol, strategy_id), …]; ``symbols`` = the
    deprecated flat mirror for legacy-row coverage (FR-6)."""
    return SimpleNamespace(
        bindings=[SimpleNamespace(symbol=s, strategy_id=st) for s, st in (bindings or [])],
        symbols=list(symbols or []),
    )


def _strat_row(strategy_id, entry=None, exit_=None):
    """A strategy row (SMA≈close via the ComputeIndicator stub) with optional entry/exit rules."""
    definition = analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name=strategy_id.upper(),
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="sma",
                kind=analysis_pb2.COMPONENT_KIND_BUILTIN_INDICATOR,
                indicator="SMA",
                params={"period": 3.0},
            )
        ],
        entry_rule=json.dumps(entry) if entry else "",
        exit_rule=json.dumps(exit_) if exit_ else "",
    )
    return {
        "strategy_id": strategy_id,
        "display_name": strategy_id.upper(),
        "active": True,
        "live_enabled": True,
        "definition_json": json_format.MessageToDict(definition),
    }


_GT_100 = {"fn": ">", "lhs": "sma", "rhs": 100.0}  # fires when last close > 100
_FIRING_BARS = [120.0, 130.0, 150.0]  # SMA≈close, last 150 > 100 → PASS


def _materialized_svc(signals=(), held=(), watchlists=(), strategies=None, bars=None):
    """A no-DB servicer wired with a _FakeOppRepo + all Universe-compute edges mocked."""
    strategies = strategies or {}
    bars = bars or {}
    svc = make_servicer()
    svc._opportunities_repo = _FakeOppRepo()
    svc._ingest = MagicMock()
    svc._ingest.QuerySignals = AsyncMock(
        return_value=SimpleNamespace(
            signals=list(signals), page=SimpleNamespace(next_page_token="")
        )
    )
    svc._portfolio = MagicMock()
    svc._portfolio.ListPositions = AsyncMock(
        return_value=SimpleNamespace(
            positions=[SimpleNamespace(symbol=s) for s in held],
            page=SimpleNamespace(next_page_token=""),
        )
    )
    svc._portfolio.ListWatchlists = AsyncMock(
        return_value=SimpleNamespace(
            watchlists=list(watchlists), page=SimpleNamespace(next_page_token="")
        )
    )
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.get_by_id = AsyncMock(side_effect=lambda sid: strategies.get(sid))
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(
        side_effect=lambda req, metadata=None: _recent_bars_resp(bars.get(req.symbol, []))
    )
    svc._indicators = MagicMock()
    svc._indicators.ComputeIndicator = AsyncMock(
        side_effect=lambda req, metadata=None: SimpleNamespace(
            result=[SimpleNamespace(value=v, extra={}) for v in req.values]
        )
    )
    return svc


async def _list_opps(svc, **kwargs):
    resp = await svc.ListOpportunities(
        analysis_pb2.ListOpportunitiesRequest(**kwargs), _ctx(_HEADERS)
    )
    return {o.symbol: o for o in resp.opportunities}, resp.opportunities


class TestListOpportunitiesMaterialized:
    @pytest.mark.asyncio
    async def test_watchlist_and_held_add_rows_with_real_readiness(self):
        """AC-1: a watchlisted symbol under strategy X and a held position each become their own
        row — not only signal-sourced symbols — the attributed one carries real passing/total."""
        svc = _materialized_svc(
            held=["TSLA"],  # unattributed held → its own row, 0/0
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS, "TSLA": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        assert set(by_symbol) == {"AAPL", "TSLA"}
        assert by_symbol["AAPL"].strategy_id == "sx"
        assert by_symbol["AAPL"].passing_conditions == 1
        assert by_symbol["AAPL"].total_conditions == 1
        # Held-but-unattributed: real row, no fabricated strategy/readiness (P-03).
        assert by_symbol["TSLA"].strategy_id == ""
        assert by_symbol["TSLA"].total_conditions == 0
        assert by_symbol["TSLA"].action == analysis_pb2.OPPORTUNITY_ACTION_TAG_ADD

    @pytest.mark.asyncio
    async def test_signal_and_watchlist_collapse_into_one_row(self):
        """AC-2/FR-4: a signal + a watchlist binding for the same symbol collapse into one row
        keyed (user, symbol, strategy) whose provenance lists both origins."""
        svc = _materialized_svc(
            signals=[_sig("AAPL", "buy", 0.9, source="uw")],
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, opps = await _list_opps(svc)
        assert len(opps) == 1
        row = by_symbol["AAPL"]
        assert row.strategy_id == "sx"
        assert row.opportunity_key == "u1|AAPL|sx"
        assert set(row.provenance) == {"watchlist", "uw"}

    @pytest.mark.asyncio
    async def test_held_exit_rule_firing_is_reduce_without_a_sell_signal(self):
        """AC-6/FR-8: a held position whose attributed strategy's exit_rule fires appears as a
        REDUCE row with real readiness, with no sell signal present."""
        svc = _materialized_svc(
            held=["AAPL"],
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100, exit_=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc)
        row = by_symbol["AAPL"]
        assert row.action == analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE
        assert row.passing_conditions == 1 and row.total_conditions == 1
        assert row.source == ""  # no signal drove it — the exit rule did

    @pytest.mark.asyncio
    async def test_readiness_is_independent_of_signal_presence(self):
        """AC-4/FR-3: a signal moves only signal_axis/rank, never passing/total. The strategy's
        readiness is identical with and without a signal on the symbol."""
        common = dict(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        svc_no_sig = _materialized_svc(**common)
        svc_sig = _materialized_svc(signals=[_sig("AAPL", "buy", 0.9)], **common)
        no_sig = (await _list_opps(svc_no_sig))[0]["AAPL"]
        sig = (await _list_opps(svc_sig))[0]["AAPL"]
        assert (no_sig.passing_conditions, no_sig.total_conditions) == (
            sig.passing_conditions,
            sig.total_conditions,
        )
        assert no_sig.conviction == sig.conviction  # readiness ordinal unchanged
        # The only thing the signal moved is the independent axis (stored, not in readiness).
        assert svc_no_sig._opportunities_repo.rows["u1"][0]["signal_axis"] == 0.0
        assert svc_sig._opportunities_repo.rows["u1"][0]["signal_axis"] == 0.9

    @pytest.mark.asyncio
    async def test_ranked_by_conviction_and_signal_axis(self):
        """Rank = (1-w)·conviction + w·signal_axis. With default w=0.3, a firing watchlist row
        (conviction 1.0) outranks a pure signal row (conviction 0, signal_axis 0.9)."""
        svc = _materialized_svc(
            signals=[_sig("MSFT", "buy", 0.9)],  # speculative, unattributed → conviction 0
            watchlists=[_wl(bindings=[("AAPL", "sx")])],  # firing → conviction 1.0
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        _, opps = await _list_opps(svc)
        assert [o.symbol for o in opps] == ["AAPL", "MSFT"]

    @pytest.mark.asyncio
    async def test_speculative_sell_signal_without_position_is_dropped(self):
        """A bare sell signal on an un-held, un-watchlisted symbol is not actionable → no row
        (parity with the pre-097 behavior). A bare buy signal stands alone as ENTER."""
        svc = _materialized_svc(
            signals=[_sig("NVDA", "sell", 0.9), _sig("GOOG", "buy", 0.8)],
        )
        by_symbol, _ = await _list_opps(svc)
        assert "NVDA" not in by_symbol
        assert by_symbol["GOOG"].action == analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER

    @pytest.mark.asyncio
    async def test_min_conviction_filters_on_readiness(self):
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx"), ("MSFT", "sy")])],
            strategies={
                "sx": _strat_row("sx", entry=_GT_100),  # fires → conviction 1.0
                "sy": _strat_row("sy", entry={"fn": ">", "lhs": "sma", "rhs": 1000.0}),  # 0.0
            },
            bars={"AAPL": _FIRING_BARS, "MSFT": _FIRING_BARS},
        )
        by_symbol, _ = await _list_opps(svc, min_conviction=0.5)
        assert set(by_symbol) == {"AAPL"}

    @pytest.mark.asyncio
    async def test_watchlist_call_propagates_headers(self):
        """C-03: the new ListWatchlists outbound call carries the x-user-id/scope/trace tuple."""
        svc = _materialized_svc(watchlists=[_wl(bindings=[("AAPL", "sx")])])
        await _list_opps(svc)
        meta = dict(svc._portfolio.ListWatchlists.await_args.kwargs["metadata"])
        assert meta == {"x-user-id": "u1", "x-access-scope": "7", "x-trace-id": "t1"}

    @pytest.mark.asyncio
    async def test_cold_read_computes_synchronously_then_serves(self):
        """Cold (never-materialized) read runs the compute inline and serves the result."""
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        assert await svc._opportunities_repo.count_for_user("u1") == 0
        by_symbol, _ = await _list_opps(svc)
        assert "AAPL" in by_symbol  # served from the synchronous compute
        assert svc._ingest.QuerySignals.await_count == 1

    @pytest.mark.asyncio
    async def test_stale_read_serves_stale_and_kicks_recompute(self):
        """A user with only expired rows is served the stale rows and a background recompute is
        kicked (stale-while-revalidate)."""
        svc = _materialized_svc(
            watchlists=[_wl(bindings=[("AAPL", "sx")])],
            strategies={"sx": _strat_row("sx", entry=_GT_100)},
            bars={"AAPL": _FIRING_BARS},
        )
        expired = datetime(2000, 1, 1, tzinfo=UTC)
        svc._opportunities_repo.rows["u1"] = [
            {
                "opportunity_key": "u1|OLD|",
                "symbol": "OLD",
                "strategy_id": "",
                "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER),
                "conviction": 0.5,
                "readiness_json": {"passing_conditions": 0, "total_conditions": 0},
                "signal_axis": 0.0,
                "provenance": [],
                "thesis": "",
                "valid_until": expired,
            }
        ]
        by_symbol, _ = await _list_opps(svc)
        assert "OLD" in by_symbol  # stale row served immediately
        # The background recompute runs on the next loop turns; it recomputes the fresh Universe.
        for _ in range(5):
            await asyncio.sleep(0)
        assert svc._ingest.QuerySignals.await_count >= 1
        assert "u1" not in svc._opportunity_recomputing  # guard cleared after it ran


class TestGetStrategyAnalytics:
    def _svc(self, runs, orders, signals_count):
        svc = make_servicer()
        svc._backtest_runs_repo = AsyncMock()
        svc._backtest_runs_repo.list_by_strategy = AsyncMock(return_value=runs)
        sig_resp = MagicMock()
        sig_resp.signals = [MagicMock() for _ in range(signals_count)]
        svc._ingest = MagicMock()
        svc._ingest.QuerySignals = AsyncMock(return_value=sig_resp)
        ord_resp = MagicMock()
        ord_resp.orders = [MagicMock() for _ in range(orders)]
        svc._trading = MagicMock()
        svc._trading.ListOrders = AsyncMock(return_value=ord_resp)
        return svc

    @pytest.mark.asyncio
    async def test_expectancy_closed_form(self):
        # win_rate 0.6, profit_factor 1.5 → payoff 1.0 → expectancy 0.6*1.0 - 0.4 = 0.2
        svc = self._svc(
            runs=[
                {"win_rate": 0.6, "profit_factor": 1.5, "max_drawdown": 0.12, "total_trades": 10}
            ],
            orders=3,
            signals_count=5,
        )
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="s1"), _ctx(_HEADERS)
        )
        assert abs(resp.expectancy - 0.2) < 1e-9
        assert abs(resp.blended_hit_rate - 0.6) < 1e-9
        assert abs(resp.max_drawdown - 0.12) < 1e-9
        assert resp.signals_30d == 5
        assert resp.taken == 3

    @pytest.mark.asyncio
    async def test_headers_reach_trading_edge(self):
        svc = self._svc(
            runs=[{"win_rate": 0.5, "profit_factor": 2.0, "max_drawdown": 0.1, "total_trades": 4}],
            orders=1,
            signals_count=0,
        )
        await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="s1"), _ctx(_HEADERS)
        )
        meta = dict(svc._trading.ListOrders.await_args.kwargs["metadata"])
        assert meta == {"x-user-id": "u1", "x-access-scope": "7", "x-trace-id": "t1"}
        # the ListOrders call is scoped to the strategy.
        assert svc._trading.ListOrders.await_args.args[0].strategy_id == "s1"

    @pytest.mark.asyncio
    async def test_no_runs_yields_zero_metrics(self):
        svc = self._svc(runs=[], orders=0, signals_count=0)
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="s1"), _ctx(_HEADERS)
        )
        assert resp.expectancy == 0.0 and resp.max_drawdown == 0.0

    def _seed_queue(self, svc, rows, actions=None):
        repo = _FakeOppRepo()
        valid = datetime(2999, 1, 1, tzinfo=UTC)
        repo.rows["u1"] = [
            {
                "opportunity_key": f"u1|{sym}|{strat}",
                "symbol": sym,
                "strategy_id": strat,
                "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER),
                "conviction": 1.0,
                "readiness_json": {"passing_conditions": 1, "total_conditions": 1},
                "signal_axis": 0.0,
                "provenance": [],
                "thesis": "",
                "valid_until": valid,
            }
            for sym, strat in rows
        ]
        repo.actions = actions or {}
        svc._opportunities_repo = repo
        return repo

    @pytest.mark.asyncio
    async def test_queue_share_is_real(self):
        """AC-5/FR-7: queue_share = strategy's attributed rows / all attributed rows; unattributed
        rows are excluded from the denominator."""
        svc = self._svc(runs=[], orders=0, signals_count=0)
        # sx: 2 rows, sy: 1 row, plus 1 unattributed → denom = 3 attributed.
        self._seed_queue(svc, rows=[("AAPL", "sx"), ("MSFT", "sx"), ("TSLA", "sy"), ("IBM", "")])
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="sx"), _ctx(_HEADERS)
        )
        assert abs(resp.queue_share - (2 / 3)) < 1e-9

    @pytest.mark.asyncio
    async def test_queue_share_zero_when_strategy_absent(self):
        svc = self._svc(runs=[], orders=0, signals_count=0)
        self._seed_queue(svc, rows=[("AAPL", "sx")])
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="sy"), _ctx(_HEADERS)
        )
        assert resp.queue_share == 0.0

    @pytest.mark.asyncio
    async def test_taken_reconciles_with_queue_takes(self):
        """FR-7: a queue TAKE on the strategy's opportunity counts even if ListOrders returns
        fewer — the two 'taken' sources read consistently (max reconciliation)."""
        svc = self._svc(runs=[], orders=0, signals_count=0)  # trading reports 0 orders
        self._seed_queue(
            svc,
            rows=[("AAPL", "sx")],
            actions={("u1", "u1|AAPL|sx"): {"action": 3, "snooze_until": None}},  # TAKE
        )
        resp = await svc.GetStrategyAnalytics(
            analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="sx"), _ctx(_HEADERS)
        )
        assert resp.taken == 1


class TestOpportunityRowParity:
    """OR-F: the materialized-row → Opportunity mapper is a producer↔reader↔UI contract point.
    A newly-added Opportunity proto field must fail until _row_to_opportunity carries it."""

    # Every Opportunity field the mapper populates (kept in lockstep with _row_to_opportunity).
    _MAPPED = {
        "symbol",
        "action",
        "conviction",
        "passing_conditions",
        "total_conditions",
        "thesis",
        "strategy_id",
        "source",
        "valid_until",
        "opportunity_key",
        "provenance",
    }
    _INTENTIONALLY_UNSET: set[str] = set()  # the mapper populates every field

    def test_mapper_covers_every_proto_field(self):
        assert self._MAPPED | self._INTENTIONALLY_UNSET == set(
            analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name
        )

    def test_guard_has_teeth(self):
        # Dropping any mapped field must break the equality (proves a new field would too).
        assert (self._MAPPED - {"provenance"}) | self._INTENTIONALLY_UNSET != set(
            analysis_pb2.Opportunity.DESCRIPTOR.fields_by_name
        )

    def test_mapper_populates_all_fields(self):
        from app.handlers.servicer import _row_to_opportunity

        valid = datetime(2999, 1, 1, tzinfo=UTC)
        row = {
            "opportunity_key": "u1|AAPL|sx",
            "symbol": "AAPL",
            "strategy_id": "sx",
            "action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE),
            "conviction": 0.75,
            "readiness_json": {"passing_conditions": 2, "total_conditions": 3},
            "signal_axis": 0.9,
            "provenance": ["watchlist", "position", "uw"],
            "thesis": "exit firing",
            "valid_until": valid,
        }
        opp = _row_to_opportunity(row)
        assert opp.symbol == "AAPL"
        assert opp.action == analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE
        assert abs(opp.conviction - 0.75) < 1e-9
        assert opp.passing_conditions == 2 and opp.total_conditions == 3
        assert opp.thesis == "exit firing"
        assert opp.strategy_id == "sx"
        assert opp.source == "uw"  # first non-structural provenance entry
        assert opp.opportunity_key == "u1|AAPL|sx"
        assert list(opp.provenance) == ["watchlist", "position", "uw"]
        assert opp.valid_until.ToDatetime(tzinfo=UTC) == valid


class TestScreenSymbolsHeld:
    @pytest.mark.asyncio
    async def test_held_marked_from_positions(self):
        svc = make_servicer()
        # No fundamental criteria → fundamentals not fetched; technical path over closes.
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(
                bars=[SimpleNamespace(close=c) for c in [10.0, 11.0, 12.0]]
            )
        )
        svc._indicators = MagicMock()
        svc._indicators.ComputeIndicator = AsyncMock(
            return_value=SimpleNamespace(result=[SimpleNamespace(value=50.0)])
        )
        svc._ingest = MagicMock()
        # portfolio holds AAPL (single page).
        pos_resp = MagicMock()
        pos_resp.positions = [MagicMock(symbol="AAPL")]
        pos_resp.page.next_page_token = ""
        svc._portfolio = MagicMock()
        svc._portfolio.ListPositions = AsyncMock(return_value=pos_resp)

        req = analysis_pb2.ScreenSymbolsRequest(symbols=["AAPL", "MSFT"])
        resp = await svc.ScreenSymbols(req, _ctx(_HEADERS))
        by_symbol = {r.symbol: r.held for r in resp.results}
        assert by_symbol.get("AAPL") is True
        assert by_symbol.get("MSFT") is False


# ---------------------------------------------------------------------------
# Feature 089 — honest strategy lifecycle (reactivate + live preconditions)
# ---------------------------------------------------------------------------


def _live_row(active=True, symbols=("AAPL",)):
    sp = {"symbols": list(symbols)} if symbols else {}
    return {
        "strategy_id": "s1",
        "display_name": "S1",
        "active": active,
        "live_enabled": False,
        "definition_json": {"strategy_id": "s1", "display_name": "S1", "signal_params": sp},
    }


class TestStrategyLifecycle089:
    @pytest.mark.asyncio
    async def test_register_duplicate_returns_already_exists(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(
                analysis_pb2.ManageStrategyRequest(
                    operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
                ),
                ctx,
            )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.ALREADY_EXISTS
        svc._strategies_repo.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_register_unique_violation_maps_to_already_exists(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        svc._strategies_repo.create = AsyncMock(side_effect=asyncpg.UniqueViolationError("dup"))
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(
                analysis_pb2.ManageStrategyRequest(
                    operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
                ),
                ctx,
            )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.ALREADY_EXISTS

    @pytest.mark.asyncio
    async def test_reactivate_sets_active(self):
        svc = make_servicer()
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        reactivated = {**_row_for(definition), "active": True}
        svc._strategies_repo.reactivate = AsyncMock(return_value=reactivated)
        resp = await svc.ManageStrategy(
            analysis_pb2.ManageStrategyRequest(
                operation=analysis_pb2.STRATEGY_OPERATION_REACTIVATE, definition=definition
            ),
            _admin_ctx(),
        )
        assert resp.strategy_id == "sma_x"
        svc._strategies_repo.reactivate.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reactivate_not_found(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=None)
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(
                analysis_pb2.ManageStrategyRequest(
                    operation=analysis_pb2.STRATEGY_OPERATION_REACTIVATE,
                    definition=_valid_definition(),
                ),
                ctx,
            )
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    @pytest.mark.asyncio
    async def test_enable_live_on_inactive_rejected(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_live_row(active=False))
        req = MagicMock(strategy_id="s1", live_enabled=True)
        ctx = _admin_ctx()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]
        with pytest.raises(Exception, match="aborted"):
            await svc.SetStrategyLive(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.FAILED_PRECONDITION

    @pytest.mark.asyncio
    async def test_enable_live_without_symbols_rejected(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_live_row(symbols=()))
        req = MagicMock(strategy_id="s1", live_enabled=True)
        ctx = _admin_ctx()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]
        with pytest.raises(Exception, match="aborted"):
            await svc.SetStrategyLive(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.FAILED_PRECONDITION

    @pytest.mark.asyncio
    async def test_disable_live_always_allowed_even_when_inert(self):
        # Disabling skips the preconditions entirely — an operator can always turn live off.
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.set_live_enabled = AsyncMock(
            return_value=_live_row(active=False, symbols=())
        )
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        req = MagicMock(strategy_id="s1", live_enabled=False)
        ctx = MagicMock()
        ctx.invocation_metadata.return_value = [("x-access-scope", "7")]
        resp = await svc.SetStrategyLive(req, ctx)
        assert resp.definition.strategy_id == "s1"
        svc._strategies_repo.get_by_id.assert_not_awaited()  # no precondition fetch on disable


# Feature 086 — deleted-formula flagging (write refusal + backtest/live status)
# ---------------------------------------------------------------------------


def _custom_formula_definition(strategy_id="s-cf", formula_id="fid"):
    return analysis_pb2.StrategyDefinition(
        strategy_id=strategy_id,
        display_name="CF strat",
        active=True,
        components=[
            analysis_pb2.StrategyComponent(
                ref_name="myf",
                kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                formula_id=formula_id,
            )
        ],
        entry_rule=json.dumps({"fn": ">", "lhs": "myf", "rhs": 0}),
    )


class TestDeletedFormulaFlag:
    @pytest.mark.asyncio
    async def test_warnings_helper_flags_deleted(self):
        svc = make_servicer()
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="fid", name="RSI", deleted=True
            )
        )
        warnings = await svc._deleted_formula_warnings(_custom_formula_definition(), [])
        assert len(warnings) == 1
        assert "fid" in warnings[0] and "RSI" in warnings[0]

    @pytest.mark.asyncio
    async def test_warnings_helper_empty_when_live(self):
        svc = make_servicer()
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="fid", deleted=False)
        )
        warnings = await svc._deleted_formula_warnings(_custom_formula_definition(), [])
        assert warnings == []

    @pytest.mark.asyncio
    async def test_register_refuses_deleted_formula_binding(self):
        svc = make_servicer()
        svc._strategies_repo = AsyncMock()
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="fid", name="RSI", deleted=True
            )
        )
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER,
            definition=_custom_formula_definition(),
        )
        ctx = _admin_ctx()
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, ctx)
        assert ctx.abort.await_args.args[0] == grpc.StatusCode.INVALID_ARGUMENT
        svc._strategies_repo.create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_get_strategy_flags_deleted_formula(self):
        svc = make_servicer()
        definition = _custom_formula_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="fid", name="RSI", deleted=True
            )
        )
        ctx = MagicMock()
        ctx.invocation_metadata = MagicMock(return_value=[])
        req = analysis_pb2.GetStrategyRequest(strategy_id="s-cf")
        result = await svc.GetStrategy(req, ctx)
        assert len(result.warnings) == 1
        assert "fid" in result.warnings[0]

    @pytest.mark.asyncio
    async def test_get_strategy_no_warning_when_formula_live(self):
        svc = make_servicer()
        definition = _custom_formula_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.get_by_id = AsyncMock(return_value=_row_for(definition))
        svc._indicators = MagicMock()
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(formula_id="fid", deleted=False)
        )
        ctx = MagicMock()
        ctx.invocation_metadata = MagicMock(return_value=[])
        req = analysis_pb2.GetStrategyRequest(strategy_id="s-cf")
        result = await svc.GetStrategy(req, ctx)
        assert list(result.warnings) == []


class TestBacktestDeletedFormulaWarning:
    @pytest.mark.asyncio
    async def test_backtest_flags_deleted_formula_and_fetches_once(self):
        from google.protobuf.struct_pb2 import Struct

        bars = _series_bars(5, 12)
        svc = make_servicer()
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
        svc._backtest_run_symbols_repo = AsyncMock()
        svc._marketdata = MagicMock()
        svc._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(page=_EOF_PAGE, bars=bars))
        svc._indicators = MagicMock()

        async def _execute(req, **kw):
            n = len(req.input_data["close"])
            out = Struct()
            out.update({"value": [1.0] * n})
            return SimpleNamespace(success=True, output=out, error="")

        svc._indicators.ExecuteFormula = AsyncMock(side_effect=_execute)
        svc._indicators.GetFormula = AsyncMock(
            return_value=indicators_pb2.FormulaDefinition(
                formula_id="f-1", name="RSI", warmup_period=3, deleted=True
            )
        )
        definition = analysis_pb2.StrategyDefinition(
            components=[
                analysis_pb2.StrategyComponent(
                    ref_name="ff",
                    kind=analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA,
                    formula_id="f-1",
                )
            ],
            entry_rule=json.dumps({"fn": ">", "lhs": "ff", "rhs": 0}),
        )
        result = await svc.RunBacktest(_windowed_req(definition), context=MagicMock())
        assert any("f-1" in w for w in result.warnings)
        # The deletion was captured on the warm-up prefetch's single fetch — no extra GetFormula.
        assert svc._indicators.GetFormula.await_count == 1


# ─── feature 097: SetOpportunityAction ───────────────────────────────────────


class _AbortError(Exception):
    """Mimics grpc.aio context.abort raising to terminate the RPC."""

    def __init__(self, code, details):
        super().__init__(details)
        self.code = code


def _opp_ctx(user_id="user-1"):
    ctx = MagicMock()
    md = [("x-user-id", user_id)] if user_id is not None else []
    ctx.invocation_metadata = MagicMock(return_value=md)

    async def _abort(code, details):
        raise _AbortError(code, details)

    ctx.abort = _abort
    return ctx


@pytest.mark.asyncio
async def test_set_opportunity_action_snooze_explicit():
    svc = make_servicer()
    svc._opportunity_actions_repo = AsyncMock()
    ts = Timestamp()
    ts.FromDatetime(datetime(2026, 8, 5, 12, 0, tzinfo=UTC))
    req = analysis_pb2.SetOpportunityActionRequest(
        opportunity_key="user-1|AAPL|strat-x",
        action=analysis_pb2.OPPORTUNITY_ACTION_SNOOZE,
        snooze_until=ts,
    )
    await svc.SetOpportunityAction(req, _opp_ctx("user-1"))
    svc._opportunity_actions_repo.upsert.assert_awaited_once()
    kw = svc._opportunity_actions_repo.upsert.await_args.kwargs
    assert kw["user_id"] == "user-1"
    assert kw["opportunity_key"] == "user-1|AAPL|strat-x"
    assert kw["action"] == analysis_pb2.OPPORTUNITY_ACTION_SNOOZE
    assert kw["snooze_until"] == datetime(2026, 8, 5, 12, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_set_opportunity_action_snooze_defaults_hours():
    svc = make_servicer()  # cfg.get_int returns default → snooze_default_hours = 24
    svc._opportunity_actions_repo = AsyncMock()
    req = analysis_pb2.SetOpportunityActionRequest(
        opportunity_key="k", action=analysis_pb2.OPPORTUNITY_ACTION_SNOOZE
    )
    before = datetime.now(UTC)
    await svc.SetOpportunityAction(req, _opp_ctx("u"))
    su = svc._opportunity_actions_repo.upsert.await_args.kwargs["snooze_until"]
    assert su is not None
    assert 23.9 <= (su - before).total_seconds() / 3600 <= 24.1


@pytest.mark.asyncio
async def test_set_opportunity_action_missing_user_invalid():
    svc = make_servicer()
    svc._opportunity_actions_repo = AsyncMock()
    req = analysis_pb2.SetOpportunityActionRequest(
        opportunity_key="k", action=analysis_pb2.OPPORTUNITY_ACTION_DISMISS
    )
    with pytest.raises(_AbortError) as ei:
        await svc.SetOpportunityAction(req, _opp_ctx(user_id=None))
    assert ei.value.code == grpc.StatusCode.INVALID_ARGUMENT
    svc._opportunity_actions_repo.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_set_opportunity_action_empty_key_invalid():
    svc = make_servicer()
    svc._opportunity_actions_repo = AsyncMock()
    req = analysis_pb2.SetOpportunityActionRequest(
        opportunity_key="", action=analysis_pb2.OPPORTUNITY_ACTION_TAKE
    )
    with pytest.raises(_AbortError) as ei:
        await svc.SetOpportunityAction(req, _opp_ctx("u"))
    assert ei.value.code == grpc.StatusCode.INVALID_ARGUMENT


@pytest.mark.asyncio
async def test_set_opportunity_action_dismiss_take_persist_enum():
    for action in (
        analysis_pb2.OPPORTUNITY_ACTION_DISMISS,
        analysis_pb2.OPPORTUNITY_ACTION_TAKE,
    ):
        svc = make_servicer()
        svc._opportunity_actions_repo = AsyncMock()
        req = analysis_pb2.SetOpportunityActionRequest(opportunity_key="k", action=action)
        await svc.SetOpportunityAction(req, _opp_ctx("u"))
        kw = svc._opportunity_actions_repo.upsert.await_args.kwargs
        assert kw["action"] == action
        assert kw["snooze_until"] is None  # only SNOOZE sets a timestamp
