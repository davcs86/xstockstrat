"""Ends the process when the event loop stops beating: strict mode exits 70, record-only mode
writes an ERROR run file first and exits 0."""

import asyncio
import logging
import os
import threading
import time

log = logging.getLogger(__name__)

LOOP_STALL_S = 30
EXIT_STALLED_STRICT = 70


class Heartbeat:
    def __init__(self):
        self.last = time.monotonic()

    async def pump(self, interval: float = 1.0) -> None:
        while True:
            self.last = time.monotonic()
            await asyncio.sleep(interval)


class Handle:
    def __init__(self, stop: threading.Event, thread: threading.Thread):
        self._stop = stop
        self.thread = thread

    def stop(self) -> None:
        self._stop.set()
        self.thread.join()


def start(
    heartbeat: Heartbeat,
    *,
    mode: str,
    stall_s: float = LOOP_STALL_S,
    poll_s: float = 1.0,
    on_stall=None,
    exit=os._exit,
) -> Handle:
    stop = threading.Event()

    def watch():
        while not stop.wait(poll_s):
            if time.monotonic() - heartbeat.last <= stall_s:
                continue
            log.critical("SMOKE_LOOP_STALLED: event loop blocked > %ss (mode=%s)", stall_s, mode)
            if mode == "strict":
                exit(EXIT_STALLED_STRICT)
                return
            try:
                if on_stall is not None:
                    on_stall()
            except Exception:  # noqa: BLE001 — record-only always exits 0
                log.exception("SMOKE_RECORD_FAILED: stall run file not written")
            exit(0)
            return

    thread = threading.Thread(target=watch, name="smoke-watchdog", daemon=True)
    thread.start()
    return Handle(stop, thread)
