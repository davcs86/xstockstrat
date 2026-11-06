"""Feature 295 @AC-23 (@preserve) — ComputePool holds the compute limit across a timed-out caller.

The thread blockers are single-consumer test infrastructure (C-13), so they stay inline.
"""

import asyncio
import re
import threading
from pathlib import Path

import pytest

pytestmark = pytest.mark.asyncio

_APP = Path(__file__).resolve().parent.parent / "app"


async def _until(cond, timeout=5.0):
    for _ in range(int(timeout / 0.01)):
        if cond():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not reached")


async def test_ac23_timed_out_backtest_keeps_its_compute_slot():
    from app.services.compute_pool import ComputePool

    pool = ComputePool(limit_fn=lambda: 4, threads=16)
    gates = [threading.Event() for _ in range(4)]
    started = [threading.Event() for _ in range(4)]
    fifth_started = threading.Event()

    def _occupant(i):
        def _fn():
            started[i].set()
            gates[i].wait(10)
            return i

        return _fn

    tasks = [asyncio.create_task(pool.run(_occupant(i))) for i in range(4)]
    fifth = None
    try:
        await _until(lambda: all(e.is_set() for e in started))

        # One backtest times out: its awaiting coroutine is cancelled, its thread keeps running.
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(tasks[0], 0.05)

        fifth = asyncio.create_task(pool.run(fifth_started.set))
        await asyncio.sleep(0.2)
        assert not fifth_started.is_set(), "a fifth compute task started above the limit of 4"

        gates[0].set()  # the timed-out backtest's thread finishes
        await asyncio.wait_for(fifth, 2)
        assert fifth_started.is_set()
    finally:
        for g in gates:
            g.set()
        await asyncio.gather(*tasks[1:], return_exceptions=True)
        if fifth is not None:
            fifth.cancel()


def test_no_raw_compute_executor_dispatch_remains():
    pattern = re.compile(r"run_in_executor\(\s*self\._compute_executor")
    hits = [
        f"{path.relative_to(_APP.parent)}"
        for path in sorted(_APP.rglob("*.py"))
        if pattern.search(path.read_text())
    ]
    assert hits == [], f"compute work bypasses ComputePool in: {hits}"
