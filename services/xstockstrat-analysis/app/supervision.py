"""Background-task supervision: retained boot tasks and loops that survive a failed tick."""

import asyncio
import functools
import logging

log = logging.getLogger(__name__)

# Fixed invariant, not a config key (design.md §3.8).
_LOOP_ERROR_BACKOFF_SECONDS = 30

# Strong references: the event loop only weakly references tasks, so an unretained task can be GC'd.
_BACKGROUND_TASKS: set[asyncio.Task] = set()


def spawn(coro, name: str, *, forever: bool) -> asyncio.Task:
    task = asyncio.get_running_loop().create_task(coro, name=name)
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(functools.partial(_on_done, forever=forever))
    return task


def _on_done(task, *, forever: bool) -> None:
    # Runs on the event loop: must never raise.
    try:
        _BACKGROUND_TASKS.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            log.error(
                "background task %s exited unexpectedly: %r", task.get_name(), exc, exc_info=exc
            )
        elif forever:
            log.info("background task %s returned", task.get_name())
    except Exception:  # noqa: BLE001 — a done-callback must never break the event loop
        log.exception("background task supervision callback failed")


async def retry_until_ok(fn, name: str):
    while True:
        try:
            return await fn()
        except Exception as e:  # noqa: BLE001 — retry until the seed succeeds
            log.error("%s failed, retrying in %ss: %s", name, _LOOP_ERROR_BACKOFF_SECONDS, e)
        await asyncio.sleep(_LOOP_ERROR_BACKOFF_SECONDS)


async def run_supervised(tick, name: str):
    while True:
        try:
            delay = await tick()
        except Exception as e:  # noqa: BLE001 — one failed tick never kills the loop
            log.error("%s: tick error, backing off %ss: %s", name, _LOOP_ERROR_BACKOFF_SECONDS, e)
            delay = _LOOP_ERROR_BACKOFF_SECONDS
        await asyncio.sleep(delay)
