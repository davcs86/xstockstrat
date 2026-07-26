"""
Unit tests for AnalysisServicer RPC methods that don't require gRPC connections.

ScoreStrategy, ListStrategies, and GetStrategyReport are exercised by
populating _backtests/_strategies directly, same pattern as ingest.
"""

import asyncio
import json
import math
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2
from google.protobuf import json_format
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer


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
        svc._strategies_repo.set_live_enabled = AsyncMock(
            return_value={
                "strategy_id": "s1",
                "display_name": "S1",
                "active": True,
                "live_enabled": True,
                "definition_json": {},
            }
        )
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
        # enough bars so the legacy path runs (>= slow_period(3)+2); values irrelevant here
        svc._marketdata.GetBars = AsyncMock(
            return_value=SimpleNamespace(
                page=_EOF_PAGE, bars=[_bar(1000 + i, 10) for i in range(6)]
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
        req = self._req(1, 700 * 86_400)  # 700 days < 730 cap
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
    """The pre-window prefix (step 4) will pass trade_start_idx > 0. Step 3 lands the plumbing
    with k = 0 everywhere and proves it is a no-op; these additionally exercise k > 0 so the
    alignment arithmetic is verified BEFORE anything depends on it.

    The invariant under test is `len(daily_equity) == len(diags)`, which
    `_finalize_symbol_diagnostics` stamps positionally. It is now asserted in that shared pass,
    so a drift raises rather than silently shifting every per-bar equity value.
    """

    @staticmethod
    def _svc(bars, fast_series, slow_series):
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

    async def _run(self, k, n=8):
        bars = [_bar(1000 + i, c) for i, c in enumerate([10, 11, 12, 13, 14, 15, 12, 9][:n])]
        svc = self._svc(bars, [9, 10, 12, 13, 14, 13, 9], [11, 11, 11, 11, 11, 11])
        return await svc._backtest_symbol(
            "AAPL",
            common_pb2.TimeRange(),
            fast_period=2,
            slow_period=3,
            signal_sources=[],
            signal_weight=0.0,
            technical_weight=1.0,
            min_conviction=0.0,
            initial_equity=100_000.0,
            commission=0.0,
            slippage=0.0,
            source_weights={},
            trade_start_idx=k,
        )

    @pytest.mark.asyncio
    async def test_default_k_zero_covers_every_bar(self):
        _, _, daily_equity, sd = await self._run(k=0)
        assert sd.bars_total == 8
        assert len(sd.bars) == 8
        assert len(daily_equity) == 8  # seed + 7 simulated
        assert [b.bar_index for b in sd.bars][:3] == [0, 1, 2]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("k", [1, 3, 5])
    async def test_prefix_bars_are_excluded_and_indices_renumbered(self, k):
        _, _, daily_equity, sd = await self._run(k=k)
        # Diagnostics cover only the in-window bars…
        assert sd.bars_total == 8 - k
        assert len(sd.bars) == 8 - k
        # …renumbered from 0, so the caller never sees prefix indices.
        assert [b.bar_index for b in sd.bars] == list(range(8 - k))
        # The invariant the shared finalize pass asserts.
        assert len(daily_equity) == len(sd.bars)

    @pytest.mark.asyncio
    async def test_first_in_window_bar_keeps_its_real_timestamp(self):
        """Renumbering bar_index must not renumber time — the prefix is dropped from the
        output, not shifted onto it."""
        _, _, _, sd = await self._run(k=3)
        assert sd.bars[0].bar_index == 0
        assert sd.bars[0].timestamp.seconds == 1003  # bar 3, not bar 0

    @pytest.mark.asyncio
    async def test_no_trade_is_reported_before_the_window(self):
        """FR-3: a prefix seeds indicators but must never open a position before `start`."""
        trades, _, _, sd = await self._run(k=5)
        first_ts = 1005
        for t in trades:
            assert t.entry_time.seconds >= first_ts
        for bar in sd.bars:
            assert bar.timestamp.seconds >= first_ts
