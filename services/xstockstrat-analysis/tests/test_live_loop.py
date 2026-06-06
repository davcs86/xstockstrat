"""
Unit tests for the LiveEvaluationLoop (feature 048-live-strategy-alert-engine).

Covers edge-triggered alerting (FR-4), the FR-6 no-trading safety guard, alert
throttling (FR-3), and per-(strategy, symbol) isolation (FR-8).
"""

import inspect
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.analysis.v1 import analysis_pb2

import app.engine.live_loop as live_loop_module
from app.engine.live_loop import LiveEvaluationLoop


def _make_loop() -> LiveEvaluationLoop:
    cfg = MagicMock()
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    loop = LiveEvaluationLoop(
        config_watcher=cfg,
        db_pool=AsyncMock(),
        marketdata_stub=AsyncMock(),
        ingest_stub=AsyncMock(),
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
        evaluator=AsyncMock(),
    )
    loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[object()]))
    loop._notify.EmitAlert = AsyncMock(return_value=MagicMock())
    loop._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    return loop


def _decision(entry: bool, exit_: bool, conviction: float = 1.0):
    return SimpleNamespace(entry=entry, exit=exit_, conviction=conviction)


class TestLiveEvaluationLoopStateTracking:
    @pytest.mark.asyncio
    async def test_entry_exit_edge_triggered(self):
        loop = _make_loop()
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1", display_name="S1")

        # 1. Entry transition (False → True) fires one alert.
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(True, False)])
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 1

        # 2. Steady-state (still entry, already in position) fires nothing.
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 1

        # 3. Exit transition (True → False) fires the second alert.
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, True)])
        await loop._eval_pair(defn, "AAPL", throttle=0)
        assert loop._notify.EmitAlert.await_count == 2

    @pytest.mark.asyncio
    async def test_no_bars_no_alert(self):
        loop = _make_loop()
        loop._marketdata.GetBars = AsyncMock(return_value=SimpleNamespace(bars=[]))
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1")
        await loop._eval_pair(defn, "AAPL", throttle=0)
        loop._notify.EmitAlert.assert_not_called()


class TestLiveEvaluationLoopThrottle:
    @pytest.mark.asyncio
    async def test_alert_suppressed_within_throttle(self):
        loop = _make_loop()
        defn = analysis_pb2.StrategyDefinition(strategy_id="s1")
        loop._evaluator.evaluate = AsyncMock(return_value=[_decision(True, False)])
        # Pretend an alert just fired for this pair.
        loop._last_alert_ts[("s1", "AAPL")] = time.monotonic()
        await loop._eval_pair(defn, "AAPL", throttle=10_000)
        loop._notify.EmitAlert.assert_not_called()


class TestLiveEvaluationLoopSafety:
    def test_no_trading_imports(self):
        src = inspect.getsource(live_loop_module)
        for forbidden in ("trading_pb2", "TradingService", "PlaceOrder", "portfolio_pb2"):
            assert forbidden not in src, f"FR-6 violation: {forbidden} present in live_loop"


class TestLiveEvaluationLoopIsolation:
    @pytest.mark.asyncio
    async def test_one_pair_error_does_not_block_others(self):
        loop = _make_loop()
        loop._db.fetch = AsyncMock(
            return_value=[
                {
                    "strategy_id": "s1",
                    "display_name": "S1",
                    "active": True,
                    "live_enabled": True,
                    "definition_json": {},
                }
            ]
        )
        loop._symbols_for = MagicMock(return_value=["AAA", "BBB"])
        calls = []

        async def fake_eval(defn, symbol, throttle):
            calls.append(symbol)
            if symbol == "AAA":
                raise RuntimeError("boom")

        loop._eval_pair = fake_eval
        await loop._run_cycle()
        assert calls == ["AAA", "BBB"]  # BBB still evaluated despite AAA error
