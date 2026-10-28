"""
Guards the WatchConfig scope-omission fix: ConfigWatcher must resolve this deployment's own
APPLICATION_ENV/TRADING_MODE into the proto scope it subscribes with, instead of leaving the
request at its zero-value (dev/unspecified) — see
docs/reports/2026-08-07-watchconfig-scope-omission-defect.md
(pruned 2026-10-05; `git show 2ce8de0a:<path>`).
"""

import pytest
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2

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
