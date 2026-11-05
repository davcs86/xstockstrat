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
# Feature 173 — presence-aware string read (get_str_present): a stored "" must
# be honored, not swallowed into the permissive default by the get_str zero-trap.
# indicators.sandbox.allowed_imports="" must deny all imports, not revert to the
# 4-module default (a security-relevant trap).
# ---------------------------------------------------------------------------


def _str_watcher(key: str, val: str) -> ConfigWatcher:
    return snapshot_watcher(**{key: val})


def test_get_str_present_honors_empty():
    w = _str_watcher("indicators.sandbox.allowed_imports", "")
    assert (
        w.get_str_present("indicators.sandbox.allowed_imports", "numpy,pandas,math,statistics")
        == ""
    )


def test_get_str_present_defaults_when_absent():
    w = ConfigWatcher.__new__(ConfigWatcher)
    w._snapshot = config_pb2.ConfigSnapshot()  # key absent
    assert w.get_str_present("indicators.sandbox.allowed_imports", "x") == "x"


def test_sandbox_allowed_imports_empty_denies_all():
    w = _str_watcher("indicators.sandbox.allowed_imports", "")
    # RED on buggy: ["numpy", "pandas", "math", "statistics"]
    assert w.sandbox_allowed_imports == []


# ---------------------------------------------------------------------------
# Feature 244 — the getters honour a stored zero (@AC-1) and still fall back to
# the default when there is no snapshot, the key is unset, or it holds another
# oneof member (@AC-4).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,stored,getter,default",
    [
        ("indicators.test.zero_int", 0, "get_int", 7),
        ("indicators.test.zero_float", 0.0, "get_float", 0.5),
        ("indicators.test.zero_string", "", "get_str", "x"),
    ],
)
def test_getters_honour_stored_zero(key, stored, getter, default):
    w = snapshot_watcher(**{key: stored})
    assert getattr(w, getter)(key, default) == stored


def _no_snapshot_watcher() -> ConfigWatcher:
    w = snapshot_watcher()
    w._snapshot = None
    return w


@pytest.mark.parametrize(
    "make,getter,key,default",
    [
        (_no_snapshot_watcher, "get_int", "indicators.test.unset_int", 7),
        (
            lambda: snapshot_watcher(**{"indicators.test.mismatched_float": "5"}),
            "get_float",
            "indicators.test.mismatched_float",
            0.5,
        ),
        (snapshot_watcher, "get_str", "indicators.test.unset_string", "x"),
    ],
)
def test_getters_default_when_unset_or_mismatched(make, getter, key, default):
    assert getattr(make(), getter)(key, default) == default


# ---------------------------------------------------------------------------
# Feature 244 @AC-6 — the sandbox int accessors read a stored value <= 0 as the coded
# default (FR-3), so a stored 0 cannot reach Semaphore(0), RLIMIT_NPROC=0 or a 0 timeout.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key,stored,read,expected",
    [
        ("indicators.sandbox.timeout_ms", 0, lambda w: w.sandbox_timeout_ms, 5000),
        ("indicators.sandbox.memory_bytes", 0, lambda w: w.sandbox_memory_bytes, 134217728),
        ("indicators.sandbox.memory_bytes", -1, lambda w: w.sandbox_memory_bytes, 134217728),
        ("indicators.sandbox.max_concurrent", 0, lambda w: w.sandbox_max_concurrent(), 4),
    ],
)
def test_sandbox_accessors_clamp_stored_non_positive(key, stored, read, expected):
    assert read(snapshot_watcher(**{key: stored})) == expected


@pytest.mark.parametrize(
    ("key", "stored", "prop", "resolved"),
    [
        ("indicators.sandbox.timeout_ms", 3000, "sandbox_timeout_ms", 3000),
        ("indicators.sandbox.memory_bytes", 100663296, "sandbox_memory_bytes", 100663296),
        (
            "indicators.sandbox.allowed_imports",
            "numpy,math",
            "sandbox_allowed_imports",
            ["numpy", "math"],
        ),
    ],
)
def test_sandbox_getters_resolve_full_dotted_rows(key, stored, prop, resolved):
    # AC-2 (feature 243): getters must read the full-dotted key that migration 031 stores.
    w = snapshot_watcher(**{key: stored})
    assert getattr(w, prop) == resolved


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
    w.namespace = "indicators"
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
    assert all(r.client_id.startswith("indicators-") for r in w._stub.requests)


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
        w = ConfigWatcher("x:1", "indicators")
        for _ in range(3):
            await asyncio.sleep(0)

    assert w._watch_task.done()
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert any("config-watch-indicators" in m and "boom" in m for m in errors)
