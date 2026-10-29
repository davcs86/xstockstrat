"""
Guards the WatchConfig scope-omission fix: ConfigWatcher must resolve this deployment's own
APPLICATION_ENV/TRADING_MODE into the proto scope it subscribes with, instead of leaving the
request at its zero-value (dev/unspecified) — see
docs/reports/2026-08-07-watchconfig-scope-omission-defect.md
(pruned 2026-10-05; `git show 2ce8de0a:<path>`).
"""

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock

import pytest
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2

import app.config.watcher as watcher_mod
from app.config.watcher import ConfigWatcher, resolve_environment, resolve_trading_mode


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
    # __new__ bypasses __init__'s channel + watch-task dial (fails-074: never a live watcher).
    w = ConfigWatcher.__new__(ConfigWatcher)
    snap = config_pb2.ConfigSnapshot()
    for key, iv in int_values.items():
        snap.values[key].int_val = iv  # sets the oneof case → HasField True even for 0
    w._snapshot = snap
    return w


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


class _Done(BaseException):
    pass


class _FakeStub:
    def __init__(self):
        self.requests = []

    def WatchConfig(self, req):
        self.requests.append(req)
        call = len(self.requests)

        async def _stream():
            if call == 1:
                raise RuntimeError("boom")
            yield config_pb2.ConfigSnapshot(version="v2")
            raise _Done()

        return _stream()


async def test_watch_reconnects_after_non_grpc_exception(monkeypatch):
    """@AC-5: a non-gRPC stream error reconnects after 2s instead of killing the watch."""
    w = ConfigWatcher.__new__(ConfigWatcher)  # dial-free (fails-074)
    w.namespace = "ingest"
    w._environment = common_pb2.ENVIRONMENT_STAGING
    w._trading_mode = common_pb2.TRADING_MODE_PAPER
    w._snapshot = None
    w._snapshot_event = asyncio.Event()
    w._stub = _FakeStub()
    sleep = AsyncMock()
    monkeypatch.setattr(watcher_mod.asyncio, "sleep", sleep)

    with pytest.raises(_Done):
        await w._watch()

    assert len(w._stub.requests) == 2
    sleep.assert_awaited_once_with(2)
    assert w._snapshot.version == "v2"
    assert all(r.client_id.startswith("ingest-") for r in w._stub.requests)


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
