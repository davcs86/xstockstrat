"""Feature 295 FR-7 — ResizableLimiter and the analysis servicer's live concurrency limits.

app/config/live_limits.py is byte-identical in indicators, ingest and analysis; its unit cases live
here. The snapshot flip and thread blockers are single-consumer test infrastructure (C-13).
"""

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock

import pytest
from gen.config.v1 import config_pb2

from tests.conftest import snapshot_watcher

pytestmark = pytest.mark.asyncio


async def _settle():
    for _ in range(10):
        await asyncio.sleep(0)


async def test_limiter_shrink_keeps_holders_and_blocks_new_acquires():
    from app.config.live_limits import ResizableLimiter

    limit = {"n": 3}
    lim = ResizableLimiter(lambda: limit["n"])
    for _ in range(3):
        await lim.acquire()

    limit["n"] = 1
    lim.wake()
    waiter = asyncio.create_task(lim.acquire())
    await _settle()
    try:
        assert lim.in_use == 3
        lim.release()
        lim.release()
        await _settle()
        assert not waiter.done()  # 1 in use is still at the limit
        lim.release()
        await asyncio.wait_for(waiter, 1)
        assert lim.in_use == 1
    finally:
        waiter.cancel()


async def test_limiter_grow_admits_waiters_only_on_wake():
    from app.config.live_limits import ResizableLimiter

    limit = {"n": 1}
    lim = ResizableLimiter(lambda: limit["n"])
    await lim.acquire()
    waiter = asyncio.create_task(lim.acquire())
    await _settle()
    try:
        assert not waiter.done()
        limit["n"] = 2
        lim.wake()
        await asyncio.wait_for(waiter, 1)
        assert lim.in_use == 2
    finally:
        waiter.cancel()


async def test_run_bounded_releases_on_thread_completion_not_on_cancel():
    from app.config.live_limits import ResizableLimiter, run_bounded

    lim = ResizableLimiter(lambda: 1)
    gate, started = threading.Event(), threading.Event()

    def _blocker():
        started.set()
        gate.wait(10)
        return "late"

    executor = ThreadPoolExecutor(max_workers=2)
    try:
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(run_bounded(lim, executor, _blocker), 0.1)
        assert started.is_set()
        # The awaiting coroutine is gone but its thread still runs: the slot stays held.
        assert lim.in_use == 1
        nxt = asyncio.create_task(run_bounded(lim, executor, lambda: "next"))
        await asyncio.sleep(0.1)
        assert not nxt.done()
        gate.set()
        assert await asyncio.wait_for(nxt, 2) == "next"
        await _settle()
        assert lim.in_use == 0
    finally:
        gate.set()
        executor.shutdown(wait=True)


_SERVICER_LIMITS = [
    ("_component_series_sem", "analysis.series.max_concurrent_components"),
    ("_bars_fetch_sem", "analysis.opportunity.max_concurrent_bars_fetches"),
    ("_candidates_sem", "analysis.opportunity.max_concurrent_candidates"),
    (
        "_readiness_materializer_bars_sem",
        "analysis.readiness_materializer.max_concurrent_bars_fetches",
    ),
]


@pytest.mark.parametrize(("attr", "key"), _SERVICER_LIMITS)
async def test_servicer_limit_grows_on_change(attr, key):
    from app.handlers.servicer import AnalysisServicer

    watcher = snapshot_watcher(**{key: 1})
    watcher._snapshot_event = asyncio.Event()
    svc = AnalysisServicer(
        watcher,
        marketdata_channel=MagicMock(),
        indicators_channel=MagicMock(),
        ingest_channel=MagicMock(),
        ledger_channel=MagicMock(),
    )
    limiter = getattr(svc, attr)
    await limiter.acquire()
    waiter = asyncio.create_task(limiter.acquire())
    await _settle()
    assert not waiter.done()

    snap = config_pb2.ConfigSnapshot(namespace="analysis", version="v2")
    snap.values[key].int_val = 2
    watcher._apply(snap)
    try:
        await asyncio.wait_for(waiter, 1)
    finally:
        waiter.cancel()
