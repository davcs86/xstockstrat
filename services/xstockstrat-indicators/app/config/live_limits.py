"""Concurrency limits that follow live config (feature 295, FR-7).

Byte-identical in indicators, ingest and analysis (scripts/check-watcher-copies.sh group py-limits).
"""

import asyncio
import contextvars
import functools
from collections import deque


class ResizableLimiter:
    """Counting limiter re-reading ``limit_fn`` per admission; a shrink never interrupts holders.

    A grow admits waiters only on ``wake()`` (register it on on_change). Single event loop only.
    """

    def __init__(self, limit_fn):
        self._limit_fn = limit_fn
        self._waiters: deque[asyncio.Future] = deque()
        self.in_use = 0

    @property
    def limit(self) -> int:
        return self._limit_fn()

    async def acquire(self) -> None:
        while self.in_use >= self._limit_fn():
            fut = asyncio.get_running_loop().create_future()
            self._waiters.append(fut)
            try:
                await fut
            finally:
                if fut in self._waiters:
                    self._waiters.remove(fut)
        self.in_use += 1

    def release(self) -> None:
        self.in_use -= 1
        self.wake()

    def wake(self, *_args) -> None:
        """Re-check every waiter against the current limit (accepts the on_change version arg)."""
        for fut in self._waiters:
            if not fut.done():
                fut.set_result(None)

    async def __aenter__(self):
        await self.acquire()
        return self

    async def __aexit__(self, *_exc):
        self.release()


async def run_bounded(lim: ResizableLimiter, executor, fn):
    """Run ``fn`` on ``executor`` under ``lim``; the slot is freed when the thread finishes,
    not when a cancelled caller (e.g. an ``asyncio.wait_for`` timeout) stops awaiting it."""
    await lim.acquire()
    loop = asyncio.get_running_loop()
    try:
        fut = loop.run_in_executor(executor, functools.partial(contextvars.copy_context().run, fn))
    except BaseException:
        lim.release()
        raise

    def _done(f):
        if not f.cancelled():
            f.exception()  # retrieved here so a cancelled caller's failure is not logged as lost
        loop.is_closed() or loop.call_soon_threadsafe(lim.release)

    fut.add_done_callback(_done)
    return await asyncio.shield(fut)
