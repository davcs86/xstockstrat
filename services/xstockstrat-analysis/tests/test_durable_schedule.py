"""Feature 158 — DurableSchedule shared helper unit tests.

Exercises the helper directly against an AsyncMock db_pool (no real DB, matching the whole tests/
suite): interval sleep-until-due with no poll-write (@AC-1), advance-after-run semantics for success
vs caught-error retry (@AC-2), the composite (job_name, user_id) key for global vs per-user jobs
(@AC-3), and the wall-clock seed anchor.

C-13: these use only scalar blocked_until_ms/job_name/user_id literals — one consumer, so inline is
compliant (no conftest centralization needed).
"""

import time
from unittest.mock import AsyncMock

import pytest

from app.engine.durable_schedule import DurableSchedule, seconds_until_hour_utc


def _sched(mode="interval", *, user_id="", anchor_hour=None, blocked_until_ms=None):
    db = AsyncMock()
    db.fetchval = AsyncMock(return_value=blocked_until_ms)
    db.execute = AsyncMock()
    return DurableSchedule(db, "demo", mode, user_id=user_id, anchor_hour=anchor_hour), db


@pytest.mark.asyncio
async def test_interval_sleep_until_due_no_poll_write():
    """@AC-1: a row due ~6h out yields a ~21600s sleep and issues NO write while merely reading."""
    now_ms = int(time.time() * 1000)
    sched, db = _sched(blocked_until_ms=now_ms + 6 * 3600 * 1000)
    sleep_s = await sched.next_sleep_seconds()
    assert abs(sleep_s - 21600) < 60
    # Reading the due time must not write (no "poll" write).
    assert db.execute.await_count == 0


@pytest.mark.asyncio
async def test_next_sleep_zero_when_due():
    sched, _ = _sched(blocked_until_ms=0)
    assert await sched.next_sleep_seconds() == 0.0


@pytest.mark.asyncio
async def test_advance_success_vs_retry():
    """@AC-2: advance(interval) on success writes ~now+interval; advance(retry) writes ~now+retry,
    strictly less than a full interval."""
    now_ms = int(time.time() * 1000)

    sched, db = _sched(blocked_until_ms=0)
    await sched.advance(24 * 3600)  # success cadence
    success_bound = db.execute.await_args_list[-1].args[1]  # blocked_until_ms bind ($1)
    assert abs(success_bound - (now_ms + 24 * 3600 * 1000)) < 5000

    sched2, db2 = _sched(blocked_until_ms=0)
    await sched2.advance(300)  # retry cadence
    retry_bound = db2.execute.await_args_list[-1].args[1]
    assert abs(retry_bound - (now_ms + 300 * 1000)) < 5000
    assert retry_bound < now_ms + 24 * 3600 * 1000


@pytest.mark.asyncio
async def test_composite_key_global_vs_per_user():
    """@AC-3: a global job binds user_id='' (never NULL); per-user jobs bind distinct user_ids under
    the same job_name → distinct (job_name, user_id) rows."""
    glob, gdb = _sched(user_id="")
    await glob.seed()
    gargs = gdb.execute.await_args_list[-1].args
    assert gargs[1] == "demo"  # job_name ($1)
    assert gargs[2] == ""  # user_id ($2) — empty string, never None
    assert gargs[2] is not None

    a, adb = _sched(user_id="u-a")
    b, bdb = _sched(user_id="u-b")
    await a.seed()
    await b.seed()
    aargs = adb.execute.await_args_list[-1].args
    bargs = bdb.execute.await_args_list[-1].args
    assert aargs[1] == "demo" and bargs[1] == "demo"  # same job_name
    assert aargs[2] == "u-a" and bargs[2] == "u-b"  # distinct user_ids


@pytest.mark.asyncio
async def test_wallclock_seed_anchors_to_next_hour():
    """A wall-clock seed sets blocked_until_ms to now + seconds_until_hour_utc(anchor), in the
    future and consistent with the relocated helper."""
    now_ms = int(time.time() * 1000)
    sched, db = _sched(mode="wallclock", anchor_hour=lambda: 8)
    await sched.seed()
    args = db.execute.await_args_list[-1].args
    seeded_ms = args[3]  # blocked_until_ms ($3) in the INSERT
    assert seeded_ms > now_ms
    expected = now_ms + int(seconds_until_hour_utc(8) * 1000)
    assert abs(seeded_ms - expected) < 5000


def test_seconds_until_hour_utc_positive():
    for h in range(24):
        assert seconds_until_hour_utc(h) > 0


def test_wallclock_requires_anchor():
    with pytest.raises(ValueError, match="anchor_hour"):
        DurableSchedule(AsyncMock(), "demo", "wallclock")


def test_invalid_mode_rejected():
    with pytest.raises(ValueError, match="invalid mode"):
        DurableSchedule(AsyncMock(), "demo", "bogus")
