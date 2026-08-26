"""Feature 158 — opportunity refresh on DurableSchedule (wall-clock).

Net-new coverage for run_opportunity_refresh_forever / _opportunity_refresh_tick (the loop had no
prior test). Uses an AsyncMock db_pool (no real DB): wall-clock re-anchor across redeploy (@AC-8),
enumeration-failure → retry-soon vs per-user-swallow → next-hour advance (@AC-9), and the config-
driven retry + bounded startup jitter (@AC-7).
"""

import time
from unittest.mock import AsyncMock

import pytest

from app.engine.durable_schedule import DurableSchedule, seconds_until_hour_utc
from tests.test_analysis_servicer import make_servicer


def _mock_pool(blocked_until_ms=0):
    pool = AsyncMock()
    pool.fetchval = AsyncMock(return_value=blocked_until_ms)
    pool.execute = AsyncMock()
    return pool


def _advance_bound(pool):
    """The blocked_until_ms ($1) of the latest DurableSchedule.advance UPDATE."""
    return pool.execute.await_args_list[-1].args[1]


@pytest.mark.asyncio
async def test_wallclock_reanchor_across_redeploy_does_not_run():
    """@AC-8: a persisted future due (08:00 tomorrow) makes the tick sleep until ≈ that time and NOT
    run the pass — never now+24h from the restart moment."""
    svc = make_servicer()
    svc._opportunities_repo = AsyncMock()
    svc._opportunities_repo.distinct_user_ids = AsyncMock(return_value=["u1"])
    # refresh_hour_utc default 0 via make_servicer's get_int_present stub.
    future_ms = int(time.time() * 1000) + int(seconds_until_hour_utc(8) * 1000)
    pool = _mock_pool(blocked_until_ms=future_ms)
    schedule = DurableSchedule(pool, "opportunity", "wallclock", anchor_hour=lambda: 8)

    sleep_s = await svc._opportunity_refresh_tick(schedule)

    assert sleep_s > 0  # sleeps until the persisted due, does not run now
    assert abs(sleep_s - seconds_until_hour_utc(8)) < 120
    svc._opportunities_repo.distinct_user_ids.assert_not_awaited()  # pass did not run
    assert pool.execute.await_count == 0  # no advance while merely waiting


@pytest.mark.asyncio
async def test_enumeration_failure_retries_soon():
    """@AC-9 / @AC-7: a distinct_user_ids failure advances by retry_seconds (config-driven, 300),
    strictly less than the next wall-clock hour — retry-soon, not skip-to-tomorrow."""
    svc = make_servicer()
    svc._opportunities_repo = AsyncMock()
    svc._opportunities_repo.distinct_user_ids = AsyncMock(side_effect=RuntimeError("db down"))
    pool = _mock_pool(blocked_until_ms=0)  # due now
    schedule = DurableSchedule(pool, "opportunity", "wallclock", anchor_hour=lambda: 8)

    now_ms = int(time.time() * 1000)
    sleep_s = await svc._opportunity_refresh_tick(schedule)

    assert sleep_s == 0.0
    bound = _advance_bound(pool)
    assert abs(bound - (now_ms + 300 * 1000)) < 5000  # ≈ now + retry_seconds
    assert bound < now_ms + 12 * 3600 * 1000  # retry-soon, never a skip-to-tomorrow (~24h)


@pytest.mark.asyncio
async def test_completed_pass_advances_to_next_hour_despite_per_user_error():
    """@AC-9: a per-user failure is swallowed → the pass still completes and advances to the next
    wall-clock hour (not the retry cadence)."""
    svc = make_servicer()
    svc._opportunities_repo = AsyncMock()
    svc._opportunities_repo.distinct_user_ids = AsyncMock(return_value=["u1"])
    # One bad user: _compute_opportunities raises, but the pass must still complete.
    svc._compute_opportunities = AsyncMock(side_effect=RuntimeError("user compute failed"))
    pool = _mock_pool(blocked_until_ms=0)  # due now
    schedule = DurableSchedule(pool, "opportunity", "wallclock", anchor_hour=lambda: 8)

    now_ms = int(time.time() * 1000)
    sleep_s = await svc._opportunity_refresh_tick(schedule)

    assert sleep_s == 0.0
    bound = _advance_bound(pool)
    # A completed pass advances to the next wall-clock hour (config refresh_hour_utc default 0 via
    # make_servicer's stub), NOT the 300s retry cadence.
    assert abs(bound - (now_ms + int(seconds_until_hour_utc(0) * 1000))) < 5000
    assert abs(bound - (now_ms + 300 * 1000)) > 60 * 1000  # not the retry cadence


@pytest.mark.asyncio
async def test_startup_jitter_bounded(monkeypatch):
    """@AC-7: the one-shot startup jitter draw is bounded [0, startup_jitter_seconds]; run_forever
    seeds then jitters then ticks. We break the loop after the first tick to assert the wiring."""
    svc = make_servicer()
    svc._opportunities_repo = AsyncMock()
    svc._db_pool = _mock_pool(blocked_until_ms=int(time.time() * 1000) + 3600 * 1000)

    draws = []

    def _capture_uniform(lo, hi):
        draws.append((lo, hi))
        return 0.0

    monkeypatch.setattr("app.handlers.servicer.random.uniform", _capture_uniform)

    # Break out of the infinite loop after the first (post-jitter) sleep.
    class _Stop(Exception):
        pass

    calls = {"n": 0}

    async def _fake_sleep(_s):
        calls["n"] += 1
        if calls["n"] >= 2:  # first = jitter sleep, second = first tick's sleep
            raise _Stop

    monkeypatch.setattr("app.handlers.servicer.asyncio.sleep", _fake_sleep)

    with pytest.raises(_Stop):
        await svc.run_opportunity_refresh_forever()

    # startup_jitter_seconds default 30 (make_servicer's get_int_present stub returns the default).
    assert draws == [(0, 30)]


@pytest.mark.asyncio
async def test_no_op_when_repo_absent():
    """The no-DB test path (opportunities repo None) returns immediately, never touching a pool."""
    svc = make_servicer()
    svc._opportunities_repo = None
    await svc.run_opportunity_refresh_forever()  # must not raise
