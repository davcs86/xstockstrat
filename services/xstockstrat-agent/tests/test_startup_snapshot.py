"""The agent blocks startup on its config snapshots (feature 295, @AC-37)."""

import asyncio
import importlib

import pytest

from tests.test_config_watcher import FakeCall, patch_dial, shutdown_tasks

_WAIT_S = 90.0


class _ByNamespaceStub:
    """`agent` answers with a snapshot then stays open; `indicators` never answers."""

    def __init__(self):
        self.namespaces: list[str] = []

    def WatchConfig(self, request, **_kwargs):
        from gen.config.v1 import config_pb2  # noqa: PLC0415

        self.namespaces.append(request.namespace)
        if request.namespace == "agent":
            return FakeCall([config_pb2.ConfigSnapshot(namespace="agent", version="v1")])
        return FakeCall([])


async def test_lifespan_fails_when_indicators_snapshot_never_arrives(monkeypatch):
    """@AC-37: startup waits wait_for_snapshot(90) per watcher and raises; never reports ready."""
    stub = _ByNamespaceStub()
    patch_dial(monkeypatch, stub)
    watcher_mod = importlib.import_module("app.config.watcher")
    monkeypatch.setattr(watcher_mod, "_WATCHERS", {})

    real_wait_for = asyncio.wait_for
    waits: list[float] = []

    async def _patched_wait_for(aw, timeout=None, **kwargs):
        # The 90 s snapshot bound elapses at once; shorter timeouts run unchanged.
        if timeout is not None and timeout >= _WAIT_S:
            waits.append(timeout)
            timeout = 0.05
        return await real_wait_for(aw, timeout, **kwargs)

    monkeypatch.setattr(asyncio, "wait_for", _patched_wait_for)

    from app.main import build_http_app  # noqa: PLC0415

    app = build_http_app()
    ready = False
    try:
        with pytest.raises(RuntimeError, match="indicators"):
            async with app.router.lifespan_context(app):
                ready = True
    finally:
        await shutdown_tasks()
    assert not ready
    assert _WAIT_S in waits
    assert {"agent", "indicators"} <= set(stub.namespaces)
