"""Feature 294 — analysis tick records, recompute and template outcomes (AC-7, AC-39, AC-51)."""

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest

from app import supervision, telemetry
from app.engine import pnl_pattern_consumer as pnl_module
from tests import test_telemetry
from tests.test_analysis_servicer import make_servicer
from tests.test_fundsignal_loop import _emit_failure_loop
from tests.test_live_loop import _StopLoop
from tests.test_live_loop_telemetry import all_attribute_values, metric_sum
from tests.test_pnl_pattern_consumer import run_until_stopped, sleeps, streaming_consumer
from tests.test_strategy_templates import (
    FakeIntents,
    FakeStrategies,
    _instantiate,
    _intent,
    _schedule,
    _strategy_row,
    _svc,
)

metric_reader = test_telemetry.metric_reader
_ = sleeps  # pytest fixture, used by name below

_OWNERS = ("u-tick-1", "u-tick-2")


def _ticks(caplog, loop=None):
    return [
        r
        for r in caplog.records
        if r.getMessage() == telemetry.LOOP_TICK_OK
        and (loop is None or r.__dict__.get("loop") == loop)
    ]


def _refresh_svc(user_ids, compute=None):
    svc = make_servicer()
    svc._opportunities_repo = AsyncMock()
    svc._opportunities_repo.distinct_user_ids = AsyncMock(return_value=list(user_ids))
    svc._compute_opportunities = compute or AsyncMock(return_value=[])
    svc._replace_and_stamp_compute_state = AsyncMock()
    return svc


async def _drain_background():
    for _ in range(5):
        await asyncio.sleep(0)


# ── loop tick records (AC-7 analysis half) ─────────────────────────────────────────────────────


async def test_opportunity_refresh_tick_record_ok_idle_and_none(caplog):
    loop = telemetry.Loop.OPPORTUNITY_REFRESH
    with caplog.at_level(logging.INFO):
        await _refresh_svc(_OWNERS)._opportunity_refresh_tick(_schedule())
    (ok,) = _ticks(caplog, loop)
    assert "state" not in ok.__dict__

    caplog.clear()
    with caplog.at_level(logging.INFO):
        await _refresh_svc(())._opportunity_refresh_tick(_schedule())
    (idle,) = _ticks(caplog, loop)
    assert idle.__dict__["state"] == "idle"

    caplog.clear()
    failing = AsyncMock(side_effect=RuntimeError("compute failed"))
    with caplog.at_level(logging.INFO):
        await _refresh_svc(_OWNERS, compute=failing)._opportunity_refresh_tick(_schedule())
    assert _ticks(caplog) == []  # every user failed: not a successful tick


async def test_readiness_materializer_tick_record_disabled_and_idle(caplog):
    loop = telemetry.Loop.READINESS_MATERIALIZER
    svc = make_servicer()  # kill-switch default OFF
    with caplog.at_level(logging.INFO):
        await svc._readiness_materializer_tick(_schedule())
    (disabled,) = _ticks(caplog, loop)
    assert disabled.__dict__["state"] == "disabled"

    caplog.clear()
    svc._cfg.get_bool = MagicMock(return_value=True)
    svc._strategies_repo = AsyncMock()
    svc._strategies_repo.list_live_enabled = AsyncMock(return_value=[])
    with caplog.at_level(logging.INFO):
        await svc._readiness_materializer_tick(_schedule())
    (idle,) = _ticks(caplog, loop)
    assert idle.__dict__["state"] == "idle"


async def test_template_intent_sweep_tick_record_ok_idle_and_enum_failure(caplog):
    loop = telemetry.Loop.TEMPLATE_INTENT_SWEEP
    intents = FakeIntents(_intent("i-bob", "bob", "COMMITTED", 0))
    with caplog.at_level(logging.INFO):
        await _svc(intents=intents)._template_intent_sweep_tick(_schedule())
    assert intents.rows["i-bob"]["state"] == "FINALIZED"
    (ok,) = _ticks(caplog, loop)
    assert "state" not in ok.__dict__

    caplog.clear()
    with caplog.at_level(logging.INFO):
        await _svc()._template_intent_sweep_tick(_schedule())
    (idle,) = _ticks(caplog, loop)
    assert idle.__dict__["state"] == "idle"

    caplog.clear()
    broken = FakeIntents()
    broken.stale = AsyncMock(side_effect=RuntimeError("db down"))
    schedule = _schedule()
    with caplog.at_level(logging.INFO):
        await _svc(intents=broken)._template_intent_sweep_tick(schedule)
    schedule.advance.assert_awaited_once()  # swallow-and-advance unchanged
    assert _ticks(caplog) == []


async def test_pnl_consumer_tick_record_is_throttled_per_minute(sleeps, monkeypatch, caplog):
    clock = {"now": 0.0}

    def _monotonic():
        clock["now"] += 20.0  # each read (event start, then record check) is 20 s later
        return clock["now"]

    # raising=False: the module only imports `time` once the tick record exists.
    monkeypatch.setattr(pnl_module, "time", SimpleNamespace(monotonic=_monotonic), raising=False)
    consumer, _pool, ledger = streaming_consumer(max_streams=1)
    with caplog.at_level(logging.INFO):
        await run_until_stopped(consumer)
    assert [e.sequence for e in ledger.events] == [9, 10, 11]
    ticks = _ticks(caplog, telemetry.Loop.PNL_CONSUMER)
    # Checks at 40, 80 and 120 s: 80 is inside the 60 s window opened at 40, so it is dropped.
    assert len(ticks) == 2
    assert [t.__dict__["duration_ms"] for t in ticks] == [20000, 20000]


async def test_pnl_consumer_one_tick_record_inside_the_window(sleeps, caplog):
    consumer, _pool, _ledger = streaming_consumer(max_streams=1)
    with caplog.at_level(logging.INFO):
        await run_until_stopped(consumer)
    assert len(_ticks(caplog, telemetry.Loop.PNL_CONSUMER)) == 1


async def test_ac7_every_analysis_tick_uses_a_fixed_loop_name(sleeps, caplog):
    with caplog.at_level(logging.INFO):
        await _refresh_svc(_OWNERS)._opportunity_refresh_tick(_schedule())
        await make_servicer()._readiness_materializer_tick(_schedule())
        intents = FakeIntents(_intent("i-bob", "bob", "COMMITTED", 0))
        await _svc(intents=intents)._template_intent_sweep_tick(_schedule())
        consumer, _pool, _ledger = streaming_consumer(max_streams=1)
        await run_until_stopped(consumer)
        fund = _emit_failure_loop()
        fund._ingest.IngestSignal = AsyncMock(return_value=MagicMock(signal_id=7))
        await fund._tick()
    records = _ticks(caplog)
    names = {m.value for m in telemetry.Loop}
    assert len(names) <= 8
    assert {r.__dict__["loop"] for r in records} == names
    for r in records:
        assert set(r.__dict__) & {"user_id", "symbol", "intent_id", "strategy_id"} == set()
        text = str({k: v for k, v in r.__dict__.items() if k not in ("msg", "message")})
        assert not [i for i in (*_OWNERS, "bob", "i-bob", "S000") if i in text]


# ── opportunity recompute outcomes (AC-51) ──────────────────────────────────────────────────────


async def test_ac51_failed_full_recompute_counted_with_traceback(metric_reader, caplog):
    svc = _refresh_svc(_OWNERS, compute=AsyncMock(side_effect=RuntimeError("x")))
    with caplog.at_level(logging.INFO):
        svc._kick_opportunity_recompute("u-tick-1", ())
        await _drain_background()
    recompute = "analysis.opportunity.recompute"
    assert metric_sum(metric_reader, recompute, kind="full", outcome="failed") == 1
    assert metric_sum(metric_reader, recompute, outcome="ok") == 0
    (rec,) = [r for r in caplog.records if "opportunity recompute failed" in r.getMessage()]
    assert rec.exc_info and rec.exc_info[0] is RuntimeError
    assert not [v for v in all_attribute_values(metric_reader) if "u-tick-1" in v]


async def test_ac51_recompute_and_retry_outcomes(metric_reader):
    svc = _refresh_svc(_OWNERS)
    svc._kick_opportunity_recompute("u-tick-1", ())
    await _drain_background()
    svc._retry_unavailable_symbols = AsyncMock(side_effect=[None, RuntimeError("retry down")])
    svc._kick_opportunity_retry("u-tick-1", ["AAA"], ())
    await _drain_background()
    svc._kick_opportunity_retry("u-tick-1", ["AAA"], ())
    await _drain_background()
    recompute = "analysis.opportunity.recompute"
    assert metric_sum(metric_reader, recompute, kind="full", outcome="ok") == 1
    assert metric_sum(metric_reader, recompute, kind="retry", outcome="ok") == 1
    assert metric_sum(metric_reader, recompute, kind="retry", outcome="failed") == 1


# ── supervised tick / seed errors carry a traceback (AC-51) ───────────────────────────────────


async def test_ac51_supervised_tick_and_seed_errors_carry_exc_info(monkeypatch, caplog):
    async def _stop(_seconds):
        raise _StopLoop

    monkeypatch.setattr(supervision.asyncio, "sleep", _stop)
    with caplog.at_level(logging.ERROR), pytest.raises(_StopLoop):
        await supervision.run_supervised(AsyncMock(side_effect=KeyError("x")), "probe")
    with caplog.at_level(logging.ERROR), pytest.raises(_StopLoop):
        await supervision.retry_until_ok(AsyncMock(side_effect=KeyError("y")), "probe seed")
    (tick,) = [r for r in caplog.records if "probe: tick error" in r.getMessage()]
    (seed,) = [r for r in caplog.records if "probe seed failed" in r.getMessage()]
    assert tick.exc_info and tick.exc_info[0] is KeyError
    assert seed.exc_info and seed.exc_info[0] is KeyError


# ── template.instantiate outcomes (AC-39 analysis half) ───────────────────────────────────────


async def test_ac39_instantiate_outcomes_counted(metric_reader):
    taken = FakeStrategies(_strategy_row("bob", "mean_reversion"))
    out, ctx = await _instantiate(_svc(strategies=taken), strategy_id="mean_reversion")
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.ALREADY_EXISTS
    out, _ctx = await _instantiate(_svc())
    assert out is not None
    _out, ctx = await _instantiate(_svc(), template_id="tpl-missing")
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND

    name = "template.instantiate"
    assert metric_sum(metric_reader, name, service="analysis", outcome="already_exists") == 1
    assert metric_sum(metric_reader, name, service="analysis", outcome="ok") == 1
    assert metric_sum(metric_reader, name, service="analysis", outcome="not_found") == 1
    assert metric_sum(metric_reader, name) == 3


def test_template_outcome_maps_unknown_codes_to_other(metric_reader):
    telemetry.record_template_instantiate(grpc.StatusCode.RESOURCE_EXHAUSTED)
    assert metric_sum(metric_reader, "template.instantiate", outcome="other") == 1
