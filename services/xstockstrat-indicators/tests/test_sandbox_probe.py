"""Startup probe (feature 300 Steps 3-4; AC-2, AC-3, AC-13, AC-14).

CI runs non-root, so the uid drop is a no-op here: the root-parent-reads-uid-65534-child path is
validated only by the staging probe line (design Open Risks).
"""

import dataclasses
import logging
import os
import re
import subprocess
from pathlib import Path

import pytest

from app import telemetry
from app.services import sandbox, sandbox_probe
from tests import test_telemetry
from tests.test_sandbox_primitives import _gauge

# The fixture is local to test_telemetry.py (not conftest); this binding exposes it here.
metric_reader = test_telemetry.metric_reader

ENFORCED = "indicators.sandbox.memory_cap_enforced"
OBSERVABLE = "indicators.sandbox.memory_watchdog_observable"
NOT_ENFORCED_MSG = "sandbox memory cap not kernel-enforced"
PROBE_FAILED_MSG = "sandbox memory probe failed"
CANNOT_OBSERVE_MSG = "sandbox memory watchdog cannot observe child"
UNMEASURABLE_MSG = "sandbox memory_used_bytes unmeasurable on this runtime"
SELF_TEST_MSG = "sandbox memory self-test "

# Child stubs speak the probe protocol on the same descriptors; `{fd}` is the handoff pipe.
_GOOD_HANDOFF = "os.write({fd}, b'H1 1000 0 -1\\n')\nos.close({fd})\n"
_STUB_SHORT_PROTOCOL = (
    "import os, sys\n"
    + _GOOD_HANDOFF
    + "print('set 1000', flush=True)\n"
    + "print('s0', flush=True)\nsys.stdin.readline()\n"
    + "print('s1', flush=True)\nsys.stdin.readline()\n"
    + "print('legs x y z', flush=True)\n"
)


@pytest.fixture(autouse=True)
def _keep_gauge_state(monkeypatch):
    monkeypatch.setattr(telemetry, "_memory_cap_enforced", None)
    monkeypatch.setattr(telemetry, "_memory_watchdog_observable", None)


def _messages(caplog, needle):
    return [r for r in caplog.records if needle in r.getMessage()]


def test_ac3_enforcing_runtime_reports_nothing_and_both_gauges_read_one(caplog, metric_reader):
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    assert not _messages(caplog, NOT_ENFORCED_MSG)
    assert not _messages(caplog, PROBE_FAILED_MSG)
    assert not _messages(caplog, CANNOT_OBSERVE_MSG)
    assert _gauge(metric_reader, ENFORCED) == 1
    assert _gauge(metric_reader, OBSERVABLE) == 1
    info = [r for r in _messages(caplog, "sandbox memory probe ") if r.levelno == logging.INFO]
    assert len(info) == 1
    for field in (
        "uname=",
        "proc_version=",
        "memory_max=",
        "rlimit_data_hard=",
        "cap_set=",
        "cap_read=",
        "vmdata_delta=",
        "rssanon_delta=",
        "probe_rss=",
        "oom_score_adj=",
        "oom_kill_readable=",
        "legs=",
        "enforced=True",
        "observable=True",
    ):
        assert field in info[0].getMessage(), field


def test_ac2_non_enforcing_runtime_logs_error_sets_gauge_zero_and_keeps_serving(
    caplog, metric_reader, monkeypatch
):
    # The kernel cap is lifted far above the legs, which emulates a runtime that ignores the limit.
    monkeypatch.setattr(sandbox_probe, "_child_headroom", lambda _n: 2**40)
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    errors = _messages(caplog, NOT_ENFORCED_MSG)
    assert len(errors) == 1 and errors[0].levelno == logging.ERROR
    assert _gauge(metric_reader, ENFORCED) == 0
    res = sandbox.execute_formula("result = {'v': 1}", {}, ["math"], timeout_ms=3000, grace_ms=3000)
    assert res.success and res.output == {"v": 1}


def test_ac2_probe_is_wired_between_init_telemetry_and_the_config_wait():
    text = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()
    telemetry_at = text.index("init_telemetry()")
    probe_at = text.index("asyncio.to_thread(run_startup_probe)")
    wait_at = text.index("wait_for_snapshot")
    assert telemetry_at < probe_at < wait_at


@pytest.mark.parametrize(
    "script,timeout",
    [
        ("raise SystemExit(3)\n", None),
        ("import time\ntime.sleep(60)\n", 1),
        (_STUB_SHORT_PROTOCOL, None),
    ],
    ids=["child-crashes", "child-hangs", "malformed-legs-line"],
)
def test_ac13_failed_probe_is_distinct_zeroes_both_gauges_and_returns(
    script, timeout, caplog, metric_reader, monkeypatch
):
    monkeypatch.setattr(sandbox_probe, "_PROBE_SCRIPT", script)
    if timeout is not None:
        monkeypatch.setattr(sandbox_probe, "_PROBE_TIMEOUT_S", timeout)
    spawned = []
    real_popen = subprocess.Popen

    def recording_popen(*args, **kwargs):
        proc = real_popen(*args, **kwargs)
        spawned.append(proc)
        return proc

    monkeypatch.setattr(sandbox_probe.subprocess, "Popen", recording_popen)
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    assert len(_messages(caplog, PROBE_FAILED_MSG)) == 1
    assert not _messages(caplog, NOT_ENFORCED_MSG)
    assert _gauge(metric_reader, ENFORCED) == 0
    assert _gauge(metric_reader, OBSERVABLE) == 0
    assert spawned and spawned[0].poll() is not None  # the group was killed and the child reaped
    with pytest.raises(ProcessLookupError):
        os.kill(spawned[0].pid, 0)


def test_ac14_memory_fields_that_do_not_move_are_reported_as_unobservable(
    caplog, metric_reader, monkeypatch
):
    monkeypatch.setattr(sandbox_probe, "_sample", lambda _pid: {"VmData": 100 * 2**20})
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    assert len(_messages(caplog, CANNOT_OBSERVE_MSG)) == 1
    assert _gauge(metric_reader, OBSERVABLE) == 0
    caplog.clear()
    sandbox._warn_unobservable_once()  # the shared once-flag is already set by the probe
    assert not _messages(caplog, CANNOT_OBSERVE_MSG)
    res = sandbox.execute_formula("result = {'v': 2}", {}, ["math"], timeout_ms=3000, grace_ms=3000)
    assert res.success


def _real_self_test_result():
    return sandbox.execute_formula("result = {}", {}, [])


def _errors(caplog, needle):
    return [r for r in _messages(caplog, needle) if r.levelno == logging.ERROR]


def test_boot_self_test_logs_a_measured_figure(caplog):
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    info = [r for r in _messages(caplog, SELF_TEST_MSG) if r.levelno == logging.INFO]
    assert len(info) == 1
    message = info[0].getMessage()
    assert "exit_reason=success" in message
    assert int(re.search(r"memory_measured=(-?\d+)", message).group(1)) > 0
    assert not _messages(caplog, UNMEASURABLE_MSG)


def test_boot_self_test_reports_an_unmeasurable_runtime_once(caplog, monkeypatch):
    zero = dataclasses.replace(_real_self_test_result(), memory_used_bytes=0)
    monkeypatch.setattr(sandbox, "execute_formula", lambda *_a, **_k: zero)
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    records = _messages(caplog, UNMEASURABLE_MSG)
    assert len(records) == 1 and records[0].levelno == logging.ERROR


def test_boot_self_test_reports_a_non_success_run(caplog, monkeypatch):
    failed = dataclasses.replace(
        _real_self_test_result(), success=False, exit_reason="runtime_error"
    )
    monkeypatch.setattr(sandbox, "execute_formula", lambda *_a, **_k: failed)
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    assert len(_errors(caplog, UNMEASURABLE_MSG)) == 1


def test_boot_self_test_that_raises_is_logged_and_never_propagates(caplog, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("boom")

    monkeypatch.setattr(sandbox, "execute_formula", boom)
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    errors = _errors(caplog, UNMEASURABLE_MSG)
    assert len(errors) == 1 and errors[0].exc_info


def test_boot_self_test_runs_when_the_memory_probe_fails(caplog, monkeypatch):
    monkeypatch.setattr(sandbox_probe, "_PROBE_SCRIPT", "raise SystemExit(3)\n")
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    assert len(_messages(caplog, PROBE_FAILED_MSG)) == 1
    info = [r for r in _messages(caplog, SELF_TEST_MSG) if r.levelno == logging.INFO]
    assert len(info) == 1


def test_boot_self_test_blind_sample_leaves_the_probe_outcome_unchanged(
    caplog, metric_reader, monkeypatch
):
    real_execute = sandbox.execute_formula

    def blind_execute(*args, **kwargs):
        sandbox._warn_unobservable_once()  # what a blind watchdog tick does in _watch
        return real_execute(*args, **kwargs)

    monkeypatch.setattr(sandbox, "execute_formula", blind_execute)
    with caplog.at_level(logging.INFO):
        sandbox_probe.run_startup_probe()
    assert not _messages(caplog, CANNOT_OBSERVE_MSG)
    assert _gauge(metric_reader, OBSERVABLE) == 1
    caplog.clear()
    sandbox._warn_unobservable_once()  # the once-flag is still armed for a real formula run
    assert len(_messages(caplog, CANNOT_OBSERVE_MSG)) == 1
