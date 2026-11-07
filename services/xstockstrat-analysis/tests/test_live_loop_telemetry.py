"""Feature 294 — live-loop pair, drain, trigger and cycle signals (AC-7, 15, 16, 18, 51)."""

import logging
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from gen.analysis.v1 import analysis_pb2

import app.engine.live_loop as live_loop_module
from app.services.evaluator import StrategyEvaluator
from tests import test_telemetry
from tests.conftest import AAPL_PIT_PERIODS
from tests.test_fundamentals_guard import _EVAL, _FSCORE_INPUTS, _formula, _ok_resp
from tests.test_live_loop import (
    _DEFAULT_BAR_DT,
    _bar_at,
    _decision,
    _live_row,
    _make_loop,
    _StopLoop,
)
from tests.test_telemetry_instruments import _data_points

metric_reader = test_telemetry.metric_reader

_EOF = SimpleNamespace(next_page_token="")
_CYCLE_COMPLETE = "live_loop: cycle complete"


def metric_sum(reader, name, **attrs):
    """Sum of a counter's data points whose attributes include ``attrs``."""
    return sum(
        p.value
        for p in _data_points(reader, name)
        if all(p.attributes.get(k) == v for k, v in attrs.items())
    )


def all_attribute_values(reader):
    data = reader.get_metrics_data()
    return [
        str(v)
        for rm in (data.resource_metrics if data else [])
        for sm in rm.scope_metrics
        for m in sm.metrics
        for p in m.data.data_points
        for v in p.attributes.values()
    ]


def _wire_drains(loop, list_positions=None):
    loop._portfolio = AsyncMock()
    loop._portfolio.ListPositions = list_positions or AsyncMock(
        return_value=SimpleNamespace(positions=[], page=_EOF)
    )
    loop._portfolio.ListWatchlists = AsyncMock(
        return_value=SimpleNamespace(watchlists=[], page=_EOF)
    )
    loop._ingest.QuerySignals = AsyncMock(return_value=SimpleNamespace(signals=[], page=_EOF))


def _one_iteration(monkeypatch):
    calls = []

    async def _sleep(seconds):
        calls.append(seconds)
        if len(calls) > 1:
            raise _StopLoop

    monkeypatch.setattr(live_loop_module.asyncio, "sleep", _sleep)
    return calls


async def _run_one_cycle(loop, monkeypatch, caplog):
    sleeps = _one_iteration(monkeypatch)
    with caplog.at_level(logging.INFO), pytest.raises(_StopLoop):
        await loop.run_forever()
    return sleeps


def _messages(caplog, text):
    return [r for r in caplog.records if r.getMessage() == text]


async def test_ac15_errored_pairs_counted_and_literal_written_once(
    metric_reader, monkeypatch, caplog
):
    loop = _make_loop()
    _wire_drains(loop)
    loop._db.fetch = AsyncMock(
        return_value=[_live_row("s1", "u1", symbols=[f"S{i:02d}" for i in range(10)])]
    )
    loop._evaluator.evaluate = AsyncMock(side_effect=RuntimeError("eval boom"))

    await _run_one_cycle(loop, monkeypatch, caplog)

    assert loop._evaluator.evaluate.await_count == 10
    assert metric_sum(metric_reader, "analysis.live_loop.pairs", outcome="error") == 10
    assert metric_sum(metric_reader, "analysis.live_loop.pairs", outcome="ok") == 0
    assert len(_messages(caplog, _CYCLE_COMPLETE)) == 1


async def test_ac15_ok_and_no_bars_pairs_counted(metric_reader):
    loop = _make_loop()
    _wire_drains(loop)
    loop._db.fetch = AsyncMock(return_value=[_live_row("s1", "u1", symbols=["AAA", "BBB"])])
    loop._evaluator.evaluate = AsyncMock(return_value=[_decision(False, False)])
    bars = (await loop._marketdata.GetBars()).bars

    async def _get_bars(req):
        return SimpleNamespace(bars=bars if req.symbol == "AAA" else [])

    loop._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    await loop._run_cycle()
    assert metric_sum(metric_reader, "analysis.live_loop.pairs", outcome="ok") == 1
    assert metric_sum(metric_reader, "analysis.live_loop.pairs", outcome="no_bars") == 1


async def test_ac16_failed_held_drain_counted_without_owner(metric_reader):
    loop = _make_loop()
    _wire_drains(loop, list_positions=AsyncMock(side_effect=RuntimeError("portfolio down")))
    held = await loop._drain_held("o-1")
    assert held == set()
    assert metric_sum(metric_reader, "analysis.live_loop.drain_failures", source="held") == 1
    assert not [v for v in all_attribute_values(metric_reader) if "o-1" in v]


async def test_ac16_failed_signal_and_watchlist_drains_counted(metric_reader):
    loop = _make_loop()
    _wire_drains(loop)
    loop._ingest.QuerySignals = AsyncMock(side_effect=RuntimeError("ingest down"))
    loop._portfolio.ListWatchlists = AsyncMock(side_effect=RuntimeError("portfolio down"))
    await loop._drain_system_signals()
    await loop._drain_watchlist("o-1")
    assert metric_sum(metric_reader, "analysis.live_loop.drain_failures", source="signals") == 1
    assert metric_sum(metric_reader, "analysis.live_loop.drain_failures", source="watchlist") == 1
    assert not [v for v in all_attribute_values(metric_reader) if "o-1" in v]


async def test_ac18_cycle_error_log_carries_exc_info(monkeypatch, caplog):
    loop = _make_loop()
    loop._run_cycle = AsyncMock(side_effect=KeyError("x"))
    await _run_one_cycle(loop, monkeypatch, caplog)
    (rec,) = [r for r in caplog.records if r.getMessage().startswith("live_loop: cycle error")]
    assert rec.exc_info and rec.exc_info[0] is KeyError
    assert _messages(caplog, _CYCLE_COMPLETE) == []


async def test_ac18_fundamentals_formula_line_is_debug(caplog):
    stub = AsyncMock()
    stub.ExecuteFormula = AsyncMock(return_value=_ok_resp())
    ev = StrategyEvaluator(stub, propagation_meta=())
    with caplog.at_level(logging.DEBUG, logger="app.services.evaluator"):
        await ev._fundamentals_formula_series(
            _formula(), len(_EVAL), _EVAL, AAPL_PIT_PERIODS, _FSCORE_INPUTS
        )
    (rec,) = [r for r in caplog.records if r.getMessage().startswith("fundamentals formula=")]
    assert rec.levelno == logging.DEBUG


async def test_ac51_triggers_and_cycle_duration(metric_reader, monkeypatch, caplog):
    clock = {"now": 1000.0}
    monkeypatch.setattr(live_loop_module, "time", SimpleNamespace(monotonic=lambda: clock["now"]))
    loop = _make_loop()
    _wire_drains(loop)
    loop._db.fetch = AsyncMock(return_value=[_live_row("s1", "u1", symbols=["AAA", "BBB"])])

    async def _evaluate(definition, bars, *args):
        return [_decision(True, False)] if bars[-1].symbol == "AAA" else [_decision(False, True)]

    async def _get_bars(req):
        bar = _bar_at(_DEFAULT_BAR_DT)
        bar.symbol = req.symbol
        return SimpleNamespace(bars=[bar])

    loop._marketdata.GetBars = AsyncMock(side_effect=_get_bars)
    loop._evaluator.evaluate = AsyncMock(side_effect=_evaluate)
    held = ("u1", "s1", "BBB")
    loop._last_state[held] = True  # an open, already-replayed position: BBB's exit transitions
    loop._last_entry_at[held] = _DEFAULT_BAR_DT - timedelta(days=30)
    loop._replayed.add(held)
    loop._last_alert_ts[held] = 1000.0  # alerted moments ago: inside the 300 s throttle
    run_cycle = loop._run_cycle

    async def _timed_cycle():
        await run_cycle()
        clock["now"] += 1.4

    loop._run_cycle = _timed_cycle

    sleeps = await _run_one_cycle(loop, monkeypatch, caplog)

    assert sleeps[0] == 60  # analysis.engine.eval_interval_seconds default
    assert loop._notify.EmitAlert.await_count == 1
    triggers = "analysis.live_loop.triggers"
    assert metric_sum(metric_reader, triggers, trigger="entry", outcome="alerted") == 1
    assert metric_sum(metric_reader, triggers, trigger="exit", outcome="throttled") == 1
    assert metric_sum(metric_reader, triggers, outcome="alert_failed") == 0
    (point,) = _data_points(metric_reader, "analysis.live_loop.cycle.duration")
    assert dict(point.attributes) == {}
    assert point.count == 1
    assert point.sum == pytest.approx(1.4)
    assert len(_messages(caplog, _CYCLE_COMPLETE)) == 1


async def test_ac51_alert_failed_propagates_and_transition_retries(metric_reader):
    loop = _make_loop()
    defn = analysis_pb2.StrategyDefinition(strategy_id="s1", user_id="u1", display_name="S1")
    loop._evaluator.evaluate = AsyncMock(return_value=[_decision(True, False)])
    loop._notify.EmitAlert = AsyncMock(side_effect=RuntimeError("notify down"))
    with pytest.raises(RuntimeError, match="notify down"):
        await loop._eval_pair(defn, "AAPL", throttle=0)
    triggers = "analysis.live_loop.triggers"
    assert metric_sum(metric_reader, triggers, trigger="entry", outcome="alert_failed") == 1
    assert metric_sum(metric_reader, triggers, outcome="alerted") == 0

    loop._notify.EmitAlert = AsyncMock(return_value=SimpleNamespace())
    await loop._eval_pair(defn, "AAPL", throttle=0)
    loop._notify.EmitAlert.assert_awaited_once()
    assert metric_sum(metric_reader, triggers, trigger="entry", outcome="alerted") == 1


async def test_ac7_live_loop_writes_only_the_cycle_literal(monkeypatch, caplog):
    loop = _make_loop()
    loop._run_cycle = AsyncMock()
    await _run_one_cycle(loop, monkeypatch, caplog)
    assert len(_messages(caplog, _CYCLE_COMPLETE)) == 1
    assert _messages(caplog, "loop tick ok") == []
