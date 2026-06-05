"""
Unit tests for AnalysisServicer RPC methods that don't require gRPC connections.

ScoreStrategy, ListStrategies, and GetStrategyReport are exercised by
populating _backtests/_strategies directly, same pattern as ingest.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2
from google.protobuf import json_format

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer


def make_servicer() -> AnalysisServicer:
    """Return an AnalysisServicer with fully mocked dependencies."""
    cfg = MagicMock()
    # Make get_float return the default argument (mirrors real watcher behaviour)
    cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: default)
    cfg.get_str = MagicMock(side_effect=lambda key, default="": default)
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


# ---------------------------------------------------------------------------
# ScoreStrategy
# ---------------------------------------------------------------------------


class TestScoreStrategy:
    @pytest.mark.asyncio
    async def test_aborts_when_no_backtest(self):
        svc = make_servicer()
        req = MagicMock()
        req.strategy_id = "unknown"
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.ScoreStrategy(req, context)

        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_score_with_rating(self):
        svc = make_servicer()
        svc._backtests["strat-a"] = _make_backtest(
            "strat-a", sharpe=1.5, drawdown=0.05, win_rate=0.65
        )
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "strat-a"
        score = await svc.ScoreStrategy(req, context=MagicMock())

        assert score.strategy_id == "strat-a"
        assert 0.0 <= score.overall_score <= 1.0
        assert score.rating in ("A", "B", "C", "D", "F")
        assert "strat-a" in svc._strategies

    @pytest.mark.asyncio
    async def test_rating_A_for_high_score(self):
        svc = make_servicer()
        # Sharpe=2.0 → component=1.0; drawdown=0 → component=1.0; win_rate=1.0 → component=1.0
        svc._backtests["s"] = _make_backtest("s", sharpe=2.0, drawdown=0.0, win_rate=1.0)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.rating == "A"

    @pytest.mark.asyncio
    async def test_rating_F_for_poor_score(self):
        svc = make_servicer()
        # Sharpe=0, drawdown=0.5, win_rate=0 → overall near 0
        svc._backtests["s"] = _make_backtest("s", sharpe=0.0, drawdown=0.5, win_rate=0.0)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.rating == "F"

    @pytest.mark.asyncio
    async def test_ledger_error_is_swallowed(self):
        svc = make_servicer()
        svc._backtests["s"] = _make_backtest("s")
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(side_effect=Exception("ledger down"))

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        # Should complete normally despite ledger failure
        assert score.strategy_id == "s"

    @pytest.mark.asyncio
    async def test_rating_C(self):
        svc = make_servicer()
        # sharpe=1.0→0.5, drawdown=0.2→0.6, win_rate=0.5→0.5; overall=0.4*0.5+0.3*0.6+0.3*0.5=0.53
        svc._backtests["s"] = _make_backtest("s", sharpe=1.0, drawdown=0.2, win_rate=0.5)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.rating == "C"

    @pytest.mark.asyncio
    async def test_rating_D(self):
        svc = make_servicer()
        # sharpe=0.8→0.4, drawdown=0.25→0.5, win_rate=0.4→0.4; overall=0.4*0.4+0.3*0.5+0.3*0.4=0.43
        svc._backtests["s"] = _make_backtest("s", sharpe=0.8, drawdown=0.25, win_rate=0.4)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        req = MagicMock()
        req.strategy_id = "s"
        score = await svc.ScoreStrategy(req, context=MagicMock())
        assert score.rating == "D"


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


class TestManageStrategy:
    @pytest.mark.asyncio
    async def test_admin_gate_aborts_when_not_admin(self):
        svc = make_servicer()
        svc._identity = None  # no identity stub → _validate_admin_token returns False
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER,
            definition=_valid_definition(),
        )
        context = MagicMock()
        context.invocation_metadata = MagicMock(return_value=[])
        context.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.ManageStrategy(req, context)
        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_register_returns_definition(self):
        svc = make_servicer()
        svc._validate_admin_token = AsyncMock(return_value=True)
        definition = _valid_definition()
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.create = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_REGISTER, definition=definition
        )
        result = await svc.ManageStrategy(req, context=MagicMock())
        assert result.strategy_id == "sma_x"
        assert result.components[0].indicator == "SMA"
        svc._strategies_repo.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_path(self):
        svc = make_servicer()
        svc._validate_admin_token = AsyncMock(return_value=True)
        definition = _valid_definition(display_name="Renamed")
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.update = AsyncMock(return_value=_row_for(definition))
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_UPDATE, definition=definition
        )
        result = await svc.ManageStrategy(req, context=MagicMock())
        assert result.display_name == "Renamed"

    @pytest.mark.asyncio
    async def test_deactivate_not_found(self):
        svc = make_servicer()
        svc._validate_admin_token = AsyncMock(return_value=True)
        svc._strategies_repo = AsyncMock()
        svc._strategies_repo.deactivate = AsyncMock(return_value=None)
        req = analysis_pb2.ManageStrategyRequest(
            operation=analysis_pb2.STRATEGY_OPERATION_DEACTIVATE,
            definition=_valid_definition(),
        )
        context = MagicMock()
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
