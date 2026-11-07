"""Agent config watchers (feature 295): snapshot policy reads (@AC-8), stall recovery (@AC-10)."""

import asyncio
import contextlib
import importlib
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from mcp.server.mcpserver import MCPServer

from app import client, tools
from tests.conftest import ADMIN, _ctx


def _watcher_mod():
    return importlib.import_module("app.config.watcher")


def _snapshot_watcher(namespace: str, **values):
    """A dial-free agent ConfigWatcher; each value lands in the oneof member matching its type."""
    from gen.config.v1 import config_pb2  # noqa: PLC0415

    w = _watcher_mod().ConfigWatcher.__new__(_watcher_mod().ConfigWatcher)
    w.namespace = namespace
    snap = config_pb2.ConfigSnapshot(namespace=namespace, version="v1")
    for key, val in values.items():
        # bool before int: bool is an int subclass.
        if isinstance(val, bool):
            snap.values[key].bool_val = val
        elif isinstance(val, int):
            snap.values[key].int_val = val
        elif isinstance(val, float):
            snap.values[key].float_val = val
        else:
            snap.values[key].string_val = val
    w._snapshot = snap
    return w


def install_watcher(monkeypatch, namespace: str, **values):
    """Register a snapshot watcher under `namespace` in the process-wide registry."""
    w = _snapshot_watcher(namespace, **values)
    monkeypatch.setitem(_watcher_mod()._WATCHERS, namespace, w)
    return w


def _tool(name: str):
    server = MCPServer("test-agent")
    tools.register_tools(server)
    return server._tool_manager.get_tool(name).fn


@pytest.mark.parametrize(("conviction", "alerted"), [(0.8, False), (0.95, True)])
async def test_ingest_signal_threshold_from_agent_snapshot(monkeypatch, conviction, alerted):
    """@AC-8: the threshold comes from the agent snapshot (0.9), with no per-call GetConfig."""
    install_watcher(monkeypatch, "agent", **{"signal.alert_threshold": 0.9})
    read = AsyncMock(return_value="0.6")
    alert = AsyncMock(return_value={"alert_id": "a1"})
    with (
        patch.object(client, "ingest_signal", AsyncMock(return_value={"deduplicated": False})),
        patch.object(client, "emit_alert", alert),
        patch.object(client, "get_config_value", read),
    ):
        await _tool("ingest_signal")(
            ctx=_ctx(ADMIN),
            source="unusual_whales",
            symbol="NVDA",
            direction="buy",
            valid_from="2026-05-01T00:00:00Z",
            conviction=conviction,
        )
    read.assert_not_awaited()
    assert alert.await_count == (1 if alerted else 0)


@pytest.mark.parametrize(
    ("key", "stored", "default", "cast", "expected"),
    [
        ("extract.max_redirects", 3, 5, int, 3),
        ("opportunities.read_timeout_seconds", 25.0, 40.0, float, 25.0),
        ("extract.max_bytes", None, 5_000_000, int, 5_000_000),
    ],
)
async def test_agent_policy_reads_snapshot(monkeypatch, key, stored, default, cast, expected):
    """Policy scalars come from the agent snapshot; an absent key keeps the code default."""
    install_watcher(monkeypatch, "agent", **({} if stored is None else {key: stored}))
    read = AsyncMock(return_value="999")
    with patch.object(client, "get_config_value", read):
        assert await tools._agent_policy(key, default, cast) == expected
    read.assert_not_awaited()


# ---------------------------------------------------------------------------
# Watcher-core fakes, as in the indicators suite: the core takes its clock from `_clock`
# (monotonic, async sleep, async wait_for), so every timer runs on virtual time.
# ---------------------------------------------------------------------------


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


async def shutdown_tasks():
    tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


class FakeCall:
    """One WatchConfig call: yields its snapshots, then stalls."""

    def __init__(self, snapshots):
        self._items = list(snapshots)
        self.cancelled = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.sleep(0)
        if self._items:
            return self._items.pop(0)
        await asyncio.Event().wait()

    def cancel(self):
        self.cancelled = True
        return True


class _ScriptedStub:
    def __init__(self, *calls):
        self._calls = list(calls)
        self.requests = []
        self.calls = []

    def WatchConfig(self, request, **_kwargs):
        self.requests.append(request)
        if len(self.requests) > 2000:
            raise _Runaway()
        call = self._calls.pop(0) if self._calls else FakeCall([])
        self.calls.append(call)
        return call


def patch_dial(monkeypatch, stub):
    """Make every ConfigWatcher dial-free: no channel, no TLS material, `stub` as the stub."""
    from gen.config.v1 import config_pb2_grpc  # noqa: PLC0415

    import app.mtls as mtls_mod  # noqa: PLC0415

    monkeypatch.setattr(grpc.aio, "secure_channel", MagicMock())
    monkeypatch.setattr(mtls_mod, "channel_credentials", MagicMock())
    monkeypatch.setattr(config_pb2_grpc, "ConfigServiceStub", MagicMock(return_value=stub))


def _int_snap(key: str, val: int):
    from gen.config.v1 import config_pb2  # noqa: PLC0415

    snap = config_pb2.ConfigSnapshot(namespace="indicators", version=f"v{val}")
    snap.values[key].int_val = val
    return snap


async def test_stalled_stream_is_abandoned_and_redialled_after_30s(monkeypatch):
    """@AC-10 agent: a silent stream is cancelled at 30 s and redialled; reads keep serving."""
    key = "indicators.sandbox.timeout_ms"
    stub = _ScriptedStub(FakeCall([_int_snap(key, 7000)]), FakeCall([_int_snap(key, 9000)]))
    clock = _FakeClock()
    patch_dial(monkeypatch, stub)
    watcher_cls = _watcher_mod().ConfigWatcher
    monkeypatch.setattr(watcher_cls, "_clock", clock, raising=False)
    w = watcher_cls("x:1", "indicators")
    try:
        await clock.advance(0)
        assert w.get_int(key, 5000) == 7000
        await clock.advance(29.0)
        assert len(stub.requests) == 1
        assert not stub.calls[0].cancelled
        await clock.advance(1.0)
        assert stub.calls[0].cancelled
        assert w.get_int(key, 5000) == 7000
        await clock.advance(1.0)
        assert len(stub.requests) == 2
        assert w.get_int(key, 5000) == 9000
        assert all(r.namespace == "indicators" for r in stub.requests)
    finally:
        await shutdown_tasks()
