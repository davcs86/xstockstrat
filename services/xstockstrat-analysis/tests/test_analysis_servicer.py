"""
Unit tests for AnalysisServicer RPC methods that don't require gRPC connections.

ScoreStrategy, ListStrategies, and GetStrategyReport are exercised by
populating _backtests/_strategies directly, same pattern as ingest.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer


def make_servicer() -> AnalysisServicer:
    """Return an AnalysisServicer with fully mocked dependencies."""
    cfg = MagicMock()
    # Make get_float return the default argument (mirrors real watcher behaviour)
    cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: default)
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
