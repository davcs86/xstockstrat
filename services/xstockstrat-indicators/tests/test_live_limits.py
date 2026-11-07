"""Feature 295 @AC-6 — indicators.sandbox.max_concurrent resizes without a restart.

C-13 verdict: the blocking sandbox double and the snapshot flip are single-consumer test
infrastructure, so they stay inline.
"""

import asyncio
import threading
import time

import pytest
from gen.config.v1 import config_pb2
from gen.indicators.v1 import indicators_pb2

from app.handlers.servicer import IndicatorsServicer
from app.services import sandbox
from app.services.sandbox import SandboxResult
from tests.conftest import OWNER_HEADERS, ctx_with, snapshot_watcher

pytestmark = pytest.mark.asyncio

_KEY = "indicators.sandbox.max_concurrent"


def _flip(watcher, version: str, limit: int) -> None:
    """Deliver a new snapshot through the watcher's real apply path, which fires on_change."""
    snap = config_pb2.ConfigSnapshot(namespace="indicators", version=version)
    snap.values[_KEY].int_val = limit
    snap.values["indicators.sandbox.allowed_imports"].string_val = ""
    watcher._apply(snap)


class _Tracker:
    def __init__(self):
        self.lock = threading.Lock()
        self.gate = threading.Event()
        self.in_flight = 0
        self.started = 0
        self.mark = None
        self.peak = 0

    def mark_now(self):
        """From here on, peak is the concurrency seen as each later call starts."""
        with self.lock:
            self.mark = self.started

    def execute(self, **_kwargs):
        with self.lock:
            self.in_flight += 1
            self.started += 1
            if self.mark is not None and self.started > self.mark:
                self.peak = max(self.peak, self.in_flight)
        self.gate.wait(10)
        time.sleep(0.15)
        with self.lock:
            self.in_flight -= 1
        return SandboxResult(
            success=True,
            output={"value": 1.0},
            stdout="",
            stderr="",
            execution_ms=150,
            memory_used_bytes=0,
            error="",
            exit_reason="success",
        )


async def _until(cond, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cond():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not reached")


def _call(servicer):
    req = indicators_pb2.ExecuteFormulaRequest(formula_source="result = {'value': 1.0}")
    return asyncio.create_task(servicer.ExecuteFormula(req, ctx_with(OWNER_HEADERS)))


async def test_ac6_shrink_lets_in_flight_finish_then_caps_at_new_limit(monkeypatch):
    tracker = _Tracker()
    monkeypatch.setattr(sandbox, "execute_formula", tracker.execute)
    watcher = snapshot_watcher(**{_KEY: 4, "indicators.sandbox.allowed_imports": ""})
    watcher._snapshot_event = asyncio.Event()
    servicer = IndicatorsServicer(config_watcher=watcher)

    first = [_call(servicer) for _ in range(4)]
    await _until(lambda: tracker.in_flight == 4)

    _flip(watcher, "v2", 2)
    tracker.mark_now()
    queued = [_call(servicer) for _ in range(4)]
    try:
        await asyncio.sleep(0.1)
        assert tracker.started == 4  # nothing new starts while 4 > 2 are in flight
    finally:
        tracker.gate.set()
        results = await asyncio.wait_for(asyncio.gather(*first, *queued), 10)

    assert all(r.success for r in results)
    assert tracker.started == 8
    # Exact, not an upper bound: the queued calls genuinely overlap, but never beyond 2.
    assert tracker.peak == 2, tracker.peak


async def test_ac6_grow_admits_waiters_on_change(monkeypatch):
    tracker = _Tracker()
    monkeypatch.setattr(sandbox, "execute_formula", tracker.execute)
    watcher = snapshot_watcher(**{_KEY: 1, "indicators.sandbox.allowed_imports": ""})
    watcher._snapshot_event = asyncio.Event()
    servicer = IndicatorsServicer(config_watcher=watcher)

    calls = [_call(servicer) for _ in range(3)]
    await _until(lambda: tracker.in_flight == 1)
    await asyncio.sleep(0.1)
    assert tracker.started == 1

    try:
        _flip(watcher, "v2", 3)
        await _until(lambda: tracker.in_flight == 3)
    finally:
        tracker.gate.set()
        await asyncio.wait_for(asyncio.gather(*calls), 10)
