"""Feature 295 — ingest.backfill.max_concurrent_jobs resizes on a config change (FR-7).

The job limiter is driven directly: acquiring a slot is exactly what _run_backfill does before a
job leaves QUEUED. The snapshot flip is single-consumer test infrastructure (C-13), so it is inline.
"""

import asyncio
from unittest.mock import MagicMock

import pytest
from gen.config.v1 import config_pb2

from app.handlers.servicer import IngestServicer
from tests.conftest import snapshot_watcher

pytestmark = pytest.mark.asyncio

_KEY = "ingest.backfill.max_concurrent_jobs"


def _flip(watcher, version: str, limit: int) -> None:
    """Deliver a new snapshot through the watcher's real apply path, which fires on_change."""
    snap = config_pb2.ConfigSnapshot(namespace="ingest", version=version)
    snap.values[_KEY].int_val = limit
    watcher._apply(snap)


def _servicer(limit: int):
    watcher = snapshot_watcher(**{_KEY: limit})
    watcher._snapshot_event = asyncio.Event()
    return watcher, IngestServicer(watcher, MagicMock(), MagicMock(), db_pool=None)


async def _settle():
    for _ in range(10):
        await asyncio.sleep(0)


async def test_backfill_limit_grows_on_change():
    watcher, svc = _servicer(1)
    await svc._backfill_sem.acquire()
    waiter = asyncio.create_task(svc._backfill_sem.acquire())
    await _settle()
    assert not waiter.done()  # job 2 stays QUEUED at limit 1

    _flip(watcher, "v2", 2)
    try:
        await asyncio.wait_for(waiter, 1)
    finally:
        waiter.cancel()


async def test_backfill_limit_shrinks_on_change():
    watcher, svc = _servicer(3)
    for _ in range(2):
        await svc._backfill_sem.acquire()

    _flip(watcher, "v2", 1)
    waiter = asyncio.create_task(svc._backfill_sem.acquire())
    await _settle()
    try:
        # Two running jobs already exceed the new limit of 1: a third stays QUEUED, and the
        # running jobs are not interrupted.
        assert not waiter.done()
        svc._backfill_sem.release()
        await _settle()
        assert not waiter.done()  # 1 in use is still at the limit
        svc._backfill_sem.release()
        await asyncio.wait_for(waiter, 1)
    finally:
        waiter.cancel()
