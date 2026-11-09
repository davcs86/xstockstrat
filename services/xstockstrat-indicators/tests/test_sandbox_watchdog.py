"""Watchdog layer 1 (feature 300 Steps 5-6; AC-6 handoff half, AC-12): the child-reported arming
line, its reader states, descriptor scope, and the resumable tick loop. Group sampling, the rules
and attribution are added with Steps 7-8.
"""

import logging
import os
import threading

import pytest

from app.services import sandbox
from tests.test_sandbox_isolation import _fake_popen

_MIB = 1024 * 1024
CANNOT_OBSERVE_MSG = "sandbox memory watchdog cannot observe child"

# Pure-Python loop: long enough to span many 50 ms ticks after the child has armed.
_BUSY_SRC = "t = 0\nfor i in range(12_000_000):\n    t += i\nresult = {'t': t}"


def _run(src, allowed=("math",), **kw):
    kw.setdefault("timeout_ms", 20000)
    kw.setdefault("memory_bytes", 128 * _MIB)
    return sandbox.execute_formula(src, {}, list(allowed), **kw)


def _messages(caplog, needle):
    return [r for r in caplog.records if needle in r.getMessage()]


# ── _arm_from_handoff (AC-12 a) ─────────────────────────────────────────────────────────────────
class TestArmFromHandoff:
    def test_base_is_cap_minus_the_child_headroom(self, h1_line):
        armed = sandbox._arm_from_handoff(h1_line(200 * _MIB + 64 * _MIB, -3, 8 * _MIB), 64 * _MIB)
        assert (armed.cap, armed.base, armed.r0, armed.stack) == (
            264 * _MIB,
            200 * _MIB,
            -3,
            8 * _MIB,
        )

    def test_base_is_identical_with_the_headroom_seam_on_and_off(self, h1_line):
        baseline, mb = 200 * _MIB, 128 * _MIB
        off = sandbox._arm_from_handoff(h1_line(baseline + mb, 0, 8 * _MIB), mb)
        on = sandbox._arm_from_handoff(h1_line(baseline + 2**40, 0, 8 * _MIB), 2**40)
        assert off.base == on.base == baseline

    @pytest.mark.parametrize("line", ["", "H1 1 2\n", "garbage\n", "H1 1 2 3"])
    def test_a_malformed_line_does_not_arm(self, line):
        assert sandbox._arm_from_handoff(line, 1) is None

    def test_a_non_positive_base_does_not_arm(self, h1_line):
        assert sandbox._arm_from_handoff(h1_line(-1, 0, 8), 128 * _MIB) is None
        assert sandbox._arm_from_handoff(h1_line(128 * _MIB, 0, 8), 128 * _MIB) is None


# ── _HandoffReader states ───────────────────────────────────────────────────────────────────────
@pytest.fixture
def pipe():
    r, w = os.pipe()
    os.set_blocking(r, False)
    yield r, w
    for fd in (r, w):
        try:
            os.close(fd)
        except OSError:
            pass


class TestHandoffReader:
    def test_pending_until_a_line_arrives_then_armed(self, pipe, h1_line):
        r, w = pipe
        reader = sandbox._HandoffReader(r, 64 * _MIB)
        assert reader.poll() == sandbox._PENDING
        os.write(w, h1_line(300 * _MIB, 0, 8 * _MIB).encode())
        assert reader.poll() == sandbox._ARMED
        assert reader.armed.base == 300 * _MIB - 64 * _MIB

    def test_a_second_line_never_re_arms(self, pipe, h1_line):
        r, w = pipe
        reader = sandbox._HandoffReader(r, 64 * _MIB)
        os.write(w, h1_line(300 * _MIB, 0, 8).encode() + h1_line(999 * _MIB, 0, 8).encode())
        assert reader.poll() == sandbox._ARMED
        first = reader.armed
        assert first.cap == 300 * _MIB  # the first complete line won, the second never counts
        assert reader.poll() == sandbox._ARMED  # the descriptor is closed: nothing more is read
        assert reader.armed is first

    def test_eof_with_no_line_is_absent(self, pipe):
        r, w = pipe
        reader = sandbox._HandoffReader(r, 1)
        os.close(w)
        assert reader.poll() == sandbox._ABSENT

    @pytest.mark.parametrize(
        "payload",
        [b"garbage\n", b"H1 1 2 3 4\n", b"x" * 200, b"H1 5 5"],
        ids=["bad-grammar", "extra-field", "no-newline-in-bound", "partial-then-eof"],
    )
    def test_anything_else_is_malformed_and_reports_once(self, pipe, payload, caplog):
        r, w = pipe
        reader = sandbox._HandoffReader(r, 1)
        os.write(w, payload)
        if payload == b"H1 5 5":
            os.close(w)
        with caplog.at_level(logging.ERROR):
            assert reader.poll() == sandbox._MALFORMED
            reader.poll()
        assert len(_messages(caplog, CANNOT_OBSERVE_MSG)) == 1


# ── wrapper wiring and descriptor scope (AC-12 c) ───────────────────────────────────────────────
def test_the_handoff_snippet_sits_between_the_cap_and_the_other_rlimits(monkeypatch):
    captured = {}
    monkeypatch.setattr("app.services.sandbox.subprocess.Popen", _fake_popen(captured))
    sandbox.execute_formula("result = 1", {}, ["math"], timeout_ms=1000, memory_bytes=64 * _MIB)
    wrapped = captured["wrapped"]
    fd = captured["kwargs"]["pass_fds"][0]
    order = [
        "import pyseccomp",
        "VmData:",
        "setrlimit(resource.RLIMIT_DATA",
        f"os.write({fd},",
        f"os.close({fd})",
        "RLIMIT_NOFILE",
        "json.loads(",
        "_flt.load()",
        "exec(",
    ]
    positions = [wrapped.index(token) for token in order]
    assert positions == sorted(positions)
    assert "_cap = min(_baseline + 67108864, 2**63 - 1)" in wrapped


def test_pass_fds_is_exactly_one_descriptor_and_never_shared_by_concurrent_runs(monkeypatch):
    seen, barrier = [], threading.Barrier(2)
    inner = _fake_popen({})

    def factory(*args, **kwargs):
        seen.append(kwargs["pass_fds"])
        barrier.wait(timeout=10)  # both runs hold their pipe at the same time
        return inner(*args, **kwargs)

    monkeypatch.setattr("app.services.sandbox.subprocess.Popen", factory)
    threads = [
        threading.Thread(
            target=sandbox.execute_formula,
            args=("result = 1", {}, ["math"]),
            kwargs={"timeout_ms": 1000, "memory_bytes": 64 * _MIB},
        )
        for _ in range(2)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
    assert len(seen) == 2 and all(len(fds) == 1 for fds in seen)
    assert seen[0] != seen[1]


def test_without_a_memory_limit_there_is_no_pipe_and_no_snippet(monkeypatch):
    captured = {}
    monkeypatch.setattr("app.services.sandbox.subprocess.Popen", _fake_popen(captured))
    sandbox.execute_formula("result = 1", {}, ["math"], timeout_ms=1000, memory_bytes=0)
    assert not captured["kwargs"].get("pass_fds")
    assert "os.write(" not in captured["wrapped"]
    assert "H1 " not in captured["wrapped"]


# ── real child: AC-6 (handoff half) and AC-12 (b) ───────────────────────────────────────────────
def test_ac6_a_malformed_handoff_reports_once_and_the_formulas_still_run(monkeypatch, caplog):
    monkeypatch.setattr(sandbox, "_HANDOFF", "os.write({fd}, b'garbage\\n')\nos.close({fd})\n")
    with caplog.at_level(logging.ERROR):
        first = _run(_BUSY_SRC)
        second = _run(_BUSY_SRC)
    assert first.success and second.success
    assert first.output == second.output
    assert len(_messages(caplog, CANNOT_OBSERVE_MSG)) == 1


def test_ac6_a_child_that_dies_before_the_handoff_emits_no_record(monkeypatch, caplog):
    monkeypatch.setattr(
        sandbox, "_VMDATA_PROBE", sandbox._VMDATA_PROBE.replace("VmData:", "VmAbsent:")
    )
    with caplog.at_level(logging.ERROR):
        res = _run("result = {'v': 1}", allowed=(), memory_bytes=64 * _MIB, timeout_ms=8000)
    assert res.success is False and res.exit_reason == "runtime_error"
    assert not _messages(caplog, CANNOT_OBSERVE_MSG)


def test_ac12_the_formula_cannot_write_to_the_closed_handoff_descriptor():
    src = (
        "import os\n"
        "ok = []\n"
        "for fd in range(3, 64):\n"
        "    try:\n"
        "        os.write(fd, b'H1 1 1 1\\n')\n"
        "        ok.append(fd)\n"
        "    except OSError:\n"
        "        pass\n"
        "result = {'writable': len(ok)}"
    )
    res = _run(src, allowed=("os",))
    assert res.success, res.error
    assert res.output == {"writable": 0}
