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
from app.services.evaluator import FormulaExecutionError


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

    @pytest.mark.asyncio
    async def test_formula_error_is_contained_by_the_loop(self):
        # feature 067: FormulaExecutionError is a plain Exception subclass, so the live
        # loop's existing broad `except Exception` already catches it and continues — no
        # new safety code (design § 5, confirm-only). A failing formula must not propagate
        # out of the cycle, and must leave _last_state untouched for the failed pair.
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
        # The evaluator raises FormulaExecutionError for AAA, returns a clean entry for BBB.
        evaluated = []

        async def fake_evaluate(defn, bars, signals):
            symbol = "AAA" if not evaluated else "BBB"
            evaluated.append(symbol)
            if symbol == "AAA":
                raise FormulaExecutionError("f-1", "boom")
            return [_decision(True, False)]

        loop._evaluator.evaluate = AsyncMock(side_effect=fake_evaluate)

        # Must not raise out of the cycle.
        await loop._run_cycle()

        # Both pairs attempted; the loop continued past the AAA formula error.
        assert evaluated == ["AAA", "BBB"]
        # The failed pair recorded no state; the healthy pair fired its entry alert.
        assert ("s1", "AAA") not in loop._last_state
        assert loop._last_state.get(("s1", "BBB")) is True
        assert loop._notify.EmitAlert.await_count == 1
