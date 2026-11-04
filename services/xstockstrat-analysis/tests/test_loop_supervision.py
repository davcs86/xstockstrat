"""Feature 259 @AC-3 — every analysis background loop survives a failed schedule read or seed."""

import logging
from unittest.mock import AsyncMock

import asyncpg
import pytest

import app.engine.fundsignal_loop as fundsignal_module
from tests.test_analysis_servicer import make_servicer
from tests.test_fundsignal_loop import _sched_loop

_TICK_SLEEP = 3600.0


class _Stop(BaseException):
    """Must not be an Exception: run_supervised would swallow it and spin."""


def _record_sleeps(monkeypatch, module):
    sleeps = []

    async def _sleep(s):
        sleeps.append(s)
        if s == _TICK_SLEEP:
            raise _Stop

    monkeypatch.setattr(module.asyncio, "sleep", _sleep)
    monkeypatch.setattr(module.random, "uniform", lambda a, b: 0)
    return sleeps


def _opportunity(svc):
    svc._opportunities_repo = AsyncMock()
    return svc.run_opportunity_refresh_forever


def _readiness(svc):
    svc._readiness_cache_repo = AsyncMock()
    svc._strategies_repo = AsyncMock()
    return svc.run_readiness_materializer_forever


def _template_sweep(svc):
    svc._template_intents_repo = AsyncMock()
    return svc.run_template_intent_sweep_forever


_SERVICER_LOOPS = [
    pytest.param(_opportunity, True, id="opportunity-refresh"),
    pytest.param(_readiness, True, id="readiness-materializer"),
    pytest.param(_template_sweep, False, id="template-intent-sweep"),
]


def _servicer_loop(monkeypatch, build, *, seed, next_sleep):
    import app.handlers.servicer as servicer_module

    monkeypatch.setattr(servicer_module.DurableSchedule, "seed", seed)
    monkeypatch.setattr(servicer_module.DurableSchedule, "next_sleep_seconds", next_sleep)
    sleeps = _record_sleeps(monkeypatch, servicer_module)
    svc = make_servicer()
    svc._db_pool = AsyncMock()
    return build(svc), sleeps


def _error_logged(caplog, text):
    return any(r.levelno == logging.ERROR and text in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
@pytest.mark.parametrize(("build", "jitter"), _SERVICER_LOOPS)
async def test_servicer_loop_survives_schedule_read_error(monkeypatch, caplog, build, jitter):
    caplog.set_level(logging.ERROR)
    next_sleep = AsyncMock(side_effect=[asyncpg.PostgresConnectionError("down"), _TICK_SLEEP])
    run, sleeps = _servicer_loop(monkeypatch, build, seed=AsyncMock(), next_sleep=next_sleep)
    with pytest.raises(_Stop):
        await run()
    assert next_sleep.await_count == 2
    assert sleeps == [*([0] if jitter else []), 30, _TICK_SLEEP]
    assert _error_logged(caplog, "down")


@pytest.mark.asyncio
@pytest.mark.parametrize(("build", "jitter"), _SERVICER_LOOPS)
async def test_servicer_loop_retries_failed_seed(monkeypatch, caplog, build, jitter):
    caplog.set_level(logging.ERROR)
    seed = AsyncMock(side_effect=[asyncpg.PostgresConnectionError("seed"), None])
    next_sleep = AsyncMock(return_value=_TICK_SLEEP)
    run, sleeps = _servicer_loop(monkeypatch, build, seed=seed, next_sleep=next_sleep)
    with pytest.raises(_Stop):
        await run()
    assert seed.await_count == 2
    assert sleeps == [30, *([0] if jitter else []), _TICK_SLEEP]
    assert _error_logged(caplog, "seed")


@pytest.mark.asyncio
async def test_fundsignal_loop_retries_failed_seed(monkeypatch, caplog):
    caplog.set_level(logging.ERROR)
    loop = _sched_loop({"analysis.fundsignal.enabled": True}, blocked_until_ms=0)
    seed = AsyncMock(side_effect=[asyncpg.PostgresConnectionError("seed"), None])
    monkeypatch.setattr(loop, "_seed_schedule", seed)
    monkeypatch.setattr(loop, "_tick", AsyncMock(return_value=_TICK_SLEEP))
    sleeps = _record_sleeps(monkeypatch, fundsignal_module)
    with pytest.raises(_Stop):
        await loop.run_forever()
    assert seed.await_count == 2
    assert sleeps == [30, 0, _TICK_SLEEP]
    assert _error_logged(caplog, "seed")
