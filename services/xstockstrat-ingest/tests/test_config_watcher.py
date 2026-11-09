"""
Guards the WatchConfig scope-omission fix: ConfigWatcher must resolve this deployment's own
APPLICATION_ENV/TRADING_MODE into the proto scope it subscribes with, instead of leaving the
request at its zero-value (dev/unspecified) — see
docs/reports/2026-08-07-watchconfig-scope-omission-defect.md
(pruned 2026-10-05; `git show 2ce8de0a:<path>`).
"""

import asyncio
import contextlib
import logging
from unittest.mock import MagicMock

import grpc
import pytest
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2, config_pb2_grpc

import app.config.watcher as watcher_mod
import app.mtls as mtls_mod
from app.config.watcher import ConfigWatcher, resolve_environment, resolve_trading_mode
from tests.conftest import snapshot_watcher


def test_resolve_environment_production():
    assert resolve_environment("production") == common_pb2.ENVIRONMENT_PRODUCTION


def test_resolve_environment_development():
    assert resolve_environment("development") == common_pb2.ENVIRONMENT_STAGING


def test_resolve_environment_unset_defaults_dev():
    assert resolve_environment("") == common_pb2.ENVIRONMENT_STAGING


def test_resolve_environment_unrecognized_defaults_dev():
    assert resolve_environment("staging") == common_pb2.ENVIRONMENT_STAGING


def test_resolve_trading_mode_live():
    assert resolve_trading_mode("live") == common_pb2.TRADING_MODE_LIVE


def test_resolve_trading_mode_paper():
    assert resolve_trading_mode("paper") == common_pb2.TRADING_MODE_PAPER


def test_resolve_trading_mode_unset_defaults_paper():
    assert resolve_trading_mode("") == common_pb2.TRADING_MODE_PAPER


# ---------------------------------------------------------------------------
# Feature 173 — presence-aware int reads (get_int_present): a stored 0 must be
# honored, not swallowed into the coded default by the get_int zero-trap.
# ---------------------------------------------------------------------------


def _int_watcher(**int_values) -> ConfigWatcher:
    return snapshot_watcher(**int_values)


@pytest.mark.parametrize(
    "key,default",
    [
        ("ingest.backfill.max_retry_attempts", 3),
        ("ingest.signals.dedup_window_hours", 24),
    ],
)
def test_get_int_present_honors_stored_zero(key, default):
    w = _int_watcher(**{key: 0})
    assert w.get_int_present(key, default) == 0


def test_get_int_present_defaults_when_absent():
    w = ConfigWatcher.__new__(ConfigWatcher)
    w._snapshot = config_pb2.ConfigSnapshot()  # key absent
    assert w.get_int_present("ingest.backfill.max_retry_attempts", 3) == 3


def test_dedup_window_hours_property_honors_zero():
    w = _int_watcher(**{"ingest.signals.dedup_window_hours": 0})
    assert w.dedup_window_hours == 0  # RED on buggy: 24


# ---------------------------------------------------------------------------
# Feature 295 — watcher-core fakes. The core takes its clock from `_clock` (monotonic, async
# sleep, async wait_for), so every timer below runs on virtual time that only advance() moves.
# ---------------------------------------------------------------------------

_KEEPALIVE = {
    "grpc.keepalive_time_ms": 30000,
    "grpc.keepalive_timeout_ms": 10000,
    "grpc.keepalive_permit_without_calls": 1,
}


class _Runaway(BaseException):
    pass


class _FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps: list[float] = []
        self._timers: list[tuple[float, asyncio.Future]] = []

    def monotonic(self) -> float:
        return self.now

    def _timer(self, delay: float) -> asyncio.Future:
        fut = asyncio.get_running_loop().create_future()
        self._timers.append((self.now + delay, fut))
        return fut

    async def sleep(self, delay: float) -> None:
        self.sleeps.append(delay)
        await self._timer(delay)

    async def wait_for(self, aw, timeout: float):
        task = asyncio.ensure_future(aw)
        timer = self._timer(timeout)
        try:
            await asyncio.wait({task, timer}, return_when=asyncio.FIRST_COMPLETED)
        except asyncio.CancelledError:
            task.cancel()
            raise
        finally:
            timer.cancel()
        if task.done():
            return task.result()
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        raise TimeoutError

    async def advance(self, seconds: float) -> None:
        target = self.now + seconds
        while True:
            await _settle()
            due = [d for d, f in self._timers if not f.done() and d <= target]
            if not due:
                break
            self.now = max(self.now, min(due))
            for d, f in self._timers:
                if d <= self.now and not f.done():
                    f.set_result(None)
            self._timers = [(d, f) for d, f in self._timers if not f.done()]
        self.now = target
        await _settle()


async def _settle():
    for _ in range(50):
        await asyncio.sleep(0)


async def _shutdown():
    tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


class _FakeCall:
    """One WatchConfig call: yields its snapshots, then stalls, ends cleanly or raises."""

    def __init__(self, snapshots, end="stall"):
        self._items = list(snapshots)
        self._end = end
        self.cancelled = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.sleep(0)
        if self._items:
            return self._items.pop(0)
        if self._end == "eof":
            raise StopAsyncIteration
        if isinstance(self._end, BaseException):
            raise self._end
        await asyncio.Event().wait()

    def cancel(self):
        self.cancelled = True
        return True


class _ScriptedStub:
    def __init__(self, *calls, then=None):
        self._calls = list(calls)
        self._then = then
        self.requests = []
        self.calls = []

    def WatchConfig(self, request, **_kwargs):
        self.requests.append(request)
        if len(self.requests) > 2000:
            raise _Runaway()
        if self._calls:
            call = self._calls.pop(0)
        elif self._then is not None:
            call = self._then()
        else:
            call = _FakeCall([])
        self.calls.append(call)
        return call


def _dial_free(monkeypatch, stub, clock, namespace="ingest"):
    channel = MagicMock()
    monkeypatch.setattr(grpc.aio, "secure_channel", channel)
    monkeypatch.setattr(mtls_mod, "channel_credentials", MagicMock())
    monkeypatch.setattr(config_pb2_grpc, "ConfigServiceStub", MagicMock(return_value=stub))
    monkeypatch.setattr(ConfigWatcher, "_clock", clock, raising=False)
    return ConfigWatcher("x:1", namespace), channel


def _int_snap(key: str, val: int, version: str = "v1") -> config_pb2.ConfigSnapshot:
    snap = config_pb2.ConfigSnapshot(version=version)
    snap.values[key].int_val = val
    return snap


def _backoffs(clock: _FakeClock) -> list[float]:
    return [s for s in clock.sleeps if s <= 30]


def _lines(caplog, text: str) -> int:
    msgs = [r.getMessage() for r in caplog.records]
    return sum(1 for m in msgs if m == text or m.startswith(text + " "))


async def test_watch_reconnects_after_non_grpc_exception(monkeypatch):
    """@AC-5: a non-gRPC stream error reconnects after the first backoff, not a fixed 2 s."""
    stub = _ScriptedStub(
        _FakeCall([], RuntimeError("boom")),
        _FakeCall([config_pb2.ConfigSnapshot(version="v2")]),
    )
    clock = _FakeClock()
    w, _ = _dial_free(monkeypatch, stub, clock)
    try:
        await clock.advance(0)
        assert len(stub.requests) == 1
        await clock.advance(1.0)
        assert len(stub.requests) == 2
        assert 0.5 <= _backoffs(clock)[0] <= 1.0
        assert w._snapshot.version == "v2"
        assert all(r.client_id.startswith("ingest-") for r in stub.requests)
    finally:
        await _shutdown()


async def test_channel_options_carry_keepalive(monkeypatch):
    """The config channel uses the fixed 30 s / 10 s keepalive and keeps the mTLS authority."""
    _, channel = _dial_free(monkeypatch, _ScriptedStub(), _FakeClock())
    try:
        call = channel.call_args
        options = dict(call.kwargs.get("options") or call.args[2])
        for name, value in _KEEPALIVE.items():
            assert options.get(name) == value, name
        assert options.get("grpc.ssl_target_name_override") == "xstockstrat-config"
    finally:
        await _shutdown()


async def test_watch_task_retained_and_exit_logged(monkeypatch, caplog):
    """@AC-8: the watch task is retained and an unexpected exit is logged at ERROR."""
    monkeypatch.setattr(watcher_mod.grpc.aio, "secure_channel", MagicMock())
    monkeypatch.setattr(watcher_mod.mtls, "channel_credentials", MagicMock())
    monkeypatch.setattr(watcher_mod.mtls, "target_override", MagicMock(return_value=[]))
    monkeypatch.setattr(watcher_mod.config_pb2_grpc, "ConfigServiceStub", MagicMock())

    async def _boom(self):
        raise RuntimeError("boom")

    monkeypatch.setattr(ConfigWatcher, "_watch", _boom)

    with caplog.at_level(logging.ERROR, logger=watcher_mod.__name__):
        w = ConfigWatcher("x:1", "ingest")
        for _ in range(3):
            await asyncio.sleep(0)

    assert w._watch_task.done()
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert any("config-watch-ingest" in m and "boom" in m for m in errors)


# ---------------------------------------------------------------------------
# Feature 244 — the getters honour a stored zero (@AC-1) and still fall back to
# the default when the key is unset or holds another oneof member (@AC-4).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,stored,getter,default",
    [
        ("ingest.test.zero_int", 0, "get_int", 7),
        ("ingest.test.zero_float", 0.0, "get_float", 0.5),
        ("ingest.test.zero_string", "", "get_str", "x"),
    ],
)
def test_getters_honour_stored_zero(key, stored, getter, default):
    w = snapshot_watcher(**{key: stored})
    assert getattr(w, getter)(key, default) == stored


@pytest.mark.parametrize(
    "values,getter,key,default",
    [
        ({}, "get_str", "ingest.test.unset_string", "x"),
        ({"ingest.test.mismatched_int": 2.5}, "get_int", "ingest.test.mismatched_int", 7),
        ({}, "get_float", "ingest.test.unset_float", 0.5),
    ],
)
def test_getters_default_when_unset_or_mismatched(values, getter, key, default):
    w = snapshot_watcher(**values)
    assert getattr(w, getter)(key, default) == default


# ---------------------------------------------------------------------------
# Feature 244 @AC-6 — an FR-3 property (semaphore bound, planner input) reads a
# stored 0 or negative as its default instead of deadlocking or busy-looping.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "prop,key,stored,expected",
    [
        ("backfill_max_concurrent_chunks", "ingest.backfill.max_concurrent_chunks", 0, 3),
        ("backfill_chunk_max_bars", "ingest.backfill.chunk_max_bars", 0, 200000),
        ("backfill_chunk_window_days", "ingest.backfill.chunk_window_days", 0, 90),
        ("backfill_max_concurrent_jobs", "ingest.backfill.max_concurrent_jobs", -5, 3),
    ],
)
def test_fr3_properties_read_non_positive_as_default(prop, key, stored, expected):
    w = snapshot_watcher(**{key: stored})
    assert getattr(w, prop) == expected


@pytest.mark.parametrize(
    "values",
    [{"ingest.backfill.max_retry_attempts": 2.5}, {}],
    ids=["float-read-as-int", "absent"],
)
def test_mismatched_or_absent_key_defaults_with_warn_naming_fqn(values, caplog):
    """FR-11: a float read as int, or an absent key, returns the default and WARNs its FQN."""
    key = "ingest.backfill.max_retry_attempts"
    w = snapshot_watcher(**values)
    with caplog.at_level(logging.WARNING):
        assert w.get_int(key, 3) == 3
    assert any(r.levelno == logging.WARNING and key in r.getMessage() for r in caplog.records)
