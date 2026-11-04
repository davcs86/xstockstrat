"""Feature 259 — background-task supervision (AC-4) and the boot wiring that retains every loop."""

import asyncio
import inspect
import logging

import asyncpg
import pytest

from app import main as app_main
from app import supervision

_BOOT_TASK_NAMES = (
    "boot-recompute",
    "live-loop",
    "entry-backfill",
    "fundsignal-loop",
    "pnl-pattern-consumer",
    "opportunity-refresh",
    "readiness-materializer",
    "template-intent-sweep",
)


class _Stop(BaseException):
    """Escapes the loops under test; an ``Exception`` sentinel would be swallowed and spin."""


def _sleep_recorder(stop_on_call: int):
    calls: list[float] = []

    async def _sleep(delay):
        calls.append(delay)
        if len(calls) >= stop_on_call:
            raise _Stop

    return calls, _sleep


async def test_crashed_task_is_logged_and_sibling_keeps_running(caplog):
    caplog.set_level(logging.INFO, logger=supervision.__name__)
    release = asyncio.Event()

    async def boom():
        raise RuntimeError("boom")

    boom_task = supervision.spawn(boom(), "boom-loop", forever=True)
    steady_task = supervision.spawn(release.wait(), "steady-loop", forever=True)
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert any(
        "boom-loop" in r.getMessage() and "boom" in r.getMessage().split("boom-loop", 1)[1]
        for r in errors
    )
    assert boom_task.done()
    assert boom_task not in supervision._BACKGROUND_TASKS
    assert not steady_task.done()
    assert steady_task in supervision._BACKGROUND_TASKS

    caplog.clear()
    steady_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await steady_task
    await asyncio.sleep(0)

    assert steady_task not in supervision._BACKGROUND_TASKS
    assert not [r for r in caplog.records if r.levelno >= logging.INFO]


async def test_normal_return_one_shot_is_silent_forever_is_info(caplog):
    caplog.set_level(logging.DEBUG, logger=supervision.__name__)

    async def done():
        return None

    one_shot = supervision.spawn(done(), "one-shot", forever=False)
    await one_shot
    await asyncio.sleep(0)
    assert not [r for r in caplog.records if r.levelno >= logging.INFO]

    forever = supervision.spawn(done(), "early-return-loop", forever=True)
    await forever
    await asyncio.sleep(0)
    levels = [(r.levelno, r.getMessage()) for r in caplog.records]
    assert any(lvl == logging.INFO and "early-return-loop" in msg for lvl, msg in levels)
    assert not [lvl for lvl, _ in levels if lvl >= logging.ERROR]


def test_on_done_never_raises():
    class _BrokenTask:
        def cancelled(self):
            return False

        def exception(self):
            raise RuntimeError("exception() blew up")

        def get_name(self):
            return "broken"

    supervision._on_done(_BrokenTask(), forever=True)


async def test_run_supervised_backs_off_after_failed_tick_then_resumes(monkeypatch, caplog):
    caplog.set_level(logging.ERROR, logger=supervision.__name__)
    calls, fake_sleep = _sleep_recorder(stop_on_call=3)
    monkeypatch.setattr(supervision.asyncio, "sleep", fake_sleep)
    ticks = 0

    async def tick():
        nonlocal ticks
        ticks += 1
        if ticks == 1:
            raise asyncpg.PostgresConnectionError("connection refused")
        return 0.0

    with pytest.raises(_Stop):
        await supervision.run_supervised(tick, "test-loop")

    assert calls[:2] == [supervision._LOOP_ERROR_BACKOFF_SECONDS, 0.0]
    assert supervision._LOOP_ERROR_BACKOFF_SECONDS == 30
    assert ticks >= 2
    assert any("test-loop" in r.getMessage() for r in caplog.records)


async def test_retry_until_ok_retries_then_returns(monkeypatch):
    calls, fake_sleep = _sleep_recorder(stop_on_call=99)
    monkeypatch.setattr(supervision.asyncio, "sleep", fake_sleep)
    attempts = 0

    async def fn():
        nonlocal attempts
        attempts += 1
        if attempts <= 2:
            raise RuntimeError("seed failed")
        return "ok"

    assert await supervision.retry_until_ok(fn, "seed") == "ok"
    assert calls == [30, 30]


def test_boot_sites_are_spawned_and_retained():
    source = inspect.getsource(app_main)
    assert source.count("create_task(") == 1
    assert source.count("spawn(") == len(_BOOT_TASK_NAMES)
    for name in _BOOT_TASK_NAMES:
        assert f'"{name}"' in source
