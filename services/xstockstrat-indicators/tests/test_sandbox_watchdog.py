"""Memory watchdog (feature 300 Steps 5-8; AC-1, AC-4..AC-8, AC-11, AC-12).

Layer 1: the child-reported arming line, its reader states, descriptor scope and the resumable tick
loop. Layer 2: group sampling over a synthetic /proc, the R1/R2 rules through a real child,
`-9` attribution by the cgroup `oom_kill` delta, evasion cases, and the `oom_score_adj` write.
"""

import logging
import os
import threading

import pytest

from app import telemetry
from app.services import sandbox
from tests import test_telemetry
from tests.test_sandbox_isolation import (
    _ALLOC_32MIB_SRC,
    _LINALG_800_SRC,
    _fake_popen,
)
from tests.test_sandbox_primitives import _gauge, _stat

# The fixture is local to test_telemetry.py (not conftest); this binding exposes it here.
metric_reader = test_telemetry.metric_reader

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


# ═══ Layer 2 (Step 8) ═══════════════════════════════════════════════════════════════════════════
WATCHDOG_LOGGER = "app.services.sandbox"
_SPIN = "t = 0\nfor i in range({n}):\n    t += 1\n"


def _peak_records(caplog):
    return [r for r in caplog.records if "sandbox watchdog peak" in r.getMessage()]


def _lift_kernel_cap(monkeypatch):
    """The kernel accepts a far larger cap, so only the parent watchdog enforces the headroom."""
    monkeypatch.setattr(sandbox, "_child_headroom", lambda _n: 2**40)


# ── AC-1: an over-headroom formula is killed by the parent ──────────────────────────────────────
def test_ac1_over_headroom_formula_is_killed_by_the_watchdog_not_the_kernel(monkeypatch, caplog):
    _lift_kernel_cap(monkeypatch)
    src = (
        "import numpy as np\n"
        "a = np.zeros(50_000_000)\n"  # ~400 MiB
        "a[:] = 1.0\n" + _SPIN.format(n=60_000_000) + "result = {'v': float(a[0])}"
    )
    with caplog.at_level(logging.DEBUG, logger=WATCHDOG_LOGGER):
        res = _run(src, allowed=("numpy", "math"))
    assert res.exit_reason == "memory_exceeded", res.error
    assert res.success is False
    assert "MemoryError" not in res.stderr  # the parent killed it, the formula never saw an error
    peaks = _peak_records(caplog)
    assert peaks and peaks[-1].peak_vmdata_growth > 128 * _MIB


# ── AC-4: legitimate work is not killed while the watchdog is active ────────────────────────────
@pytest.mark.parametrize(
    "src,expected",
    [
        (_LINALG_800_SRC + "\n" + _SPIN.format(n=6_000_000), {"trace": 641260.869, "rank": 50}),
        (_ALLOC_32MIB_SRC + "\n" + _SPIN.format(n=6_000_000), {"v": 4194304.0}),
    ],
    ids=["matmul-800x800", "alloc-32MiB"],
)
def test_ac4_legitimate_formulas_survive_with_the_watchdog_active(
    src, expected, monkeypatch, caplog
):
    _lift_kernel_cap(monkeypatch)
    with caplog.at_level(logging.DEBUG, logger=WATCHDOG_LOGGER):
        res = _run(src, allowed=("numpy", "math"), memory_bytes=64 * _MIB)
    assert res.success, res.error
    assert res.output == expected
    peaks = _peak_records(caplog)
    assert peaks, "the run armed and was sampled"
    peak = peaks[-1]
    print(  # recorded in context.md (design open risk: R2 near-cap margin)
        f"AC-4 peaks: vmdata_growth={peak.peak_vmdata_growth} resident={peak.peak_resident} "
        f"r1_limit={peak.r1_limit} r2_limit={peak.r2_limit}"
    )
    assert peak.peak_vmdata_growth <= peak.r1_limit
    assert peak.peak_resident <= peak.r2_limit


# ── AC-5: -9 is attributed by evidence ──────────────────────────────────────────────────────────
def _killed_proc(events_file, bump):
    """A fake child that exits with SIGKILL; `bump` is how far the cgroup oom_kill count rises."""

    class _Proc:
        pid = 2**30
        returncode = None

        def communicate(self, input=None, timeout=None):
            if bump and events_file is not None:
                events_file.write_text(f"oom 0\noom_kill {1 + bump}\n")
            self.returncode = -9
            return ("", "")

    return lambda *a, **k: _Proc()


@pytest.mark.parametrize(
    "bump,reason", [(1, "memory_exceeded"), (0, "runtime_error"), (None, "runtime_error")]
)
def test_ac5_a_sigkilled_child_is_memory_exceeded_only_with_an_oom_kill_delta(
    bump, reason, monkeypatch, tmp_path
):
    events = tmp_path / "memory.events"
    if bump is None:
        monkeypatch.setattr(sandbox, "_OOM_EVENTS_PATH", str(tmp_path / "missing"))
        events_file = None
    else:
        events.write_text("oom 0\noom_kill 1\n")
        monkeypatch.setattr(sandbox, "_OOM_EVENTS_PATH", str(events))
        events_file = events
    monkeypatch.setattr(
        "app.services.sandbox.subprocess.Popen", _killed_proc(events_file, bump or 0)
    )
    res = sandbox.execute_formula(
        "result = 1", {}, ["math"], timeout_ms=1000, memory_bytes=64 * _MIB
    )
    assert res.exit_reason == reason
    assert res.error == "formula exited with code -9 before producing output"


# ── AC-6 (observability half): an unreadable /proc says so once ─────────────────────────────────
def test_ac6_a_denied_proc_reports_once_and_the_formulas_still_run(
    monkeypatch, caplog, metric_reader
):
    monkeypatch.setattr(telemetry, "_memory_watchdog_observable", None)

    def denied(_pid, _state):
        raise PermissionError("hidepid")

    monkeypatch.setattr(sandbox, "_sample_group", denied)
    with caplog.at_level(logging.ERROR):
        first = _run(_BUSY_SRC)
        second = _run(_BUSY_SRC)
    assert first.success and second.success
    assert len(_messages(caplog, CANNOT_OBSERVE_MSG)) == 1
    assert _gauge(metric_reader, "indicators.sandbox.memory_watchdog_observable") == 0


# ── AC-7: group sampling over a synthetic /proc ─────────────────────────────────────────────────
def _write_proc(root, pid, *, pgrp, start, status, state="S"):
    d = root / str(pid)
    d.mkdir(exist_ok=True)
    (d / "stat").write_text(_stat(state=state, pgrp=pgrp, starttime=start))
    (d / "status").write_text(status)


class TestSampleGroup:
    @pytest.fixture
    def tree(self, tmp_path, monkeypatch):
        monkeypatch.setattr(sandbox, "_PROC", str(tmp_path))
        return tmp_path

    @pytest.fixture
    def state(self):
        armed = sandbox._Armed(cap=300 * _MIB, base=200 * _MIB, r0=0, stack=8 * _MIB)
        return sandbox._GroupState(armed)

    def test_leader_counts_fully_and_other_groups_are_ignored(self, tree, state, proc_status_text):
        _write_proc(tree, 100, pgrp=100, start=1, status=proc_status_text(250 * _MIB, 60 * _MIB, 0))
        _write_proc(tree, 7, pgrp=7, start=1, status=proc_status_text(900 * _MIB, 900 * _MIB, 0))
        sample = sandbox._sample_group(100, state)
        assert (sample.growth, sample.resident, sample.blind) == (50 * _MIB, 60 * _MIB, False)

    def test_a_forked_member_counts_only_its_growth_since_first_sight(
        self, tree, state, proc_status_text
    ):
        leader = proc_status_text(250 * _MIB, 60 * _MIB, 0)
        _write_proc(tree, 100, pgrp=100, start=1, status=leader)
        _write_proc(tree, 101, pgrp=100, start=5, status=proc_status_text(250 * _MIB, 60 * _MIB, 0))
        assert sandbox._sample_group(100, state).growth == 50 * _MIB  # COW child adds ~0
        _write_proc(tree, 101, pgrp=100, start=5, status=proc_status_text(290 * _MIB, 60 * _MIB, 0))
        assert sandbox._sample_group(100, state).growth == 50 * _MIB + 40 * _MIB

    def test_a_reused_pid_with_a_new_start_time_is_a_new_member(
        self, tree, state, proc_status_text
    ):
        _write_proc(tree, 100, pgrp=100, start=1, status=proc_status_text(250 * _MIB, 60 * _MIB, 0))
        _write_proc(tree, 101, pgrp=100, start=5, status=proc_status_text(250 * _MIB, 60 * _MIB, 0))
        sandbox._sample_group(100, state)
        _write_proc(tree, 101, pgrp=100, start=9, status=proc_status_text(80 * _MIB, 10 * _MIB, 0))
        assert sandbox._sample_group(100, state).growth == 50 * _MIB  # new member, ref = 80 MiB

    def test_zombies_contribute_nothing_and_are_never_evidence_of_blindness(
        self, tree, state, proc_status_text, caplog
    ):
        _write_proc(
            tree,
            100,
            pgrp=100,
            start=1,
            status=proc_status_text(250 * _MIB, 60 * _MIB, 0),
        )
        _write_proc(tree, 101, pgrp=100, start=5, status=proc_status_text(state="Z"), state="Z")
        _write_proc(tree, 102, pgrp=100, start=6, status=proc_status_text(state="X"), state="X")
        with caplog.at_level(logging.ERROR):
            sample = sandbox._sample_group(100, state)
        assert sample.blind is False
        assert (sample.growth, sample.resident) == (50 * _MIB, 60 * _MIB)
        assert not _messages(caplog, CANNOT_OBSERVE_MSG)

    def test_a_zombie_leader_does_not_stop_the_rest_of_the_group_counting(
        self, tree, state, proc_status_text
    ):
        _write_proc(tree, 100, pgrp=100, start=1, status=proc_status_text(state="Z"), state="Z")
        _write_proc(tree, 101, pgrp=100, start=5, status=proc_status_text(250 * _MIB, 70 * _MIB, 0))
        sample = sandbox._sample_group(100, state)
        assert sample.blind is False and sample.resident == 70 * _MIB

    def test_missing_rssanon_skips_only_the_resident_rule_silently(
        self, tree, state, proc_status_text, caplog
    ):
        _write_proc(tree, 100, pgrp=100, start=1, status=proc_status_text(vmdata=260 * _MIB))
        with caplog.at_level(logging.ERROR):
            sample = sandbox._sample_group(100, state)
        assert sample.growth == 60 * _MIB and sample.resident is None and sample.blind is False
        assert not _messages(caplog, CANNOT_OBSERVE_MSG)

    def test_a_running_member_with_no_memory_fields_at_all_is_blind(
        self, tree, state, proc_status_text
    ):
        _write_proc(tree, 100, pgrp=100, start=1, status=proc_status_text())
        assert sandbox._sample_group(100, state).blind is True

    def test_a_vanished_process_is_silent(self, tree, state, proc_status_text):
        _write_proc(tree, 100, pgrp=100, start=1, status=proc_status_text(250 * _MIB, 60 * _MIB, 0))
        (tree / "100" / "status").unlink()  # exits between the stat and status reads
        sample = sandbox._sample_group(100, state)
        assert sample.blind is False


# ── AC-8: a fork-bomb stays a typed error and the service recovers ──────────────────────────────
def test_ac8_fork_bomb_is_not_a_success_the_service_recovers_and_nothing_is_unobservable(caplog):
    with caplog.at_level(logging.ERROR):
        res = _run(
            "import os\nfor _ in range(10000):\n    os.fork()\nresult = {'v': 1}",
            allowed=("os",),
            max_concurrent=1,
            timeout_ms=8000,
        )
        ok = _run("result = {'value': 7}", allowed=(), timeout_ms=8000)
    assert res.success is False
    assert res.exit_reason in ("runtime_error", "memory_exceeded")  # residual (d): either is typed
    assert ok.success is True and ok.output == {"value": 7}
    assert not _messages(caplog, CANNOT_OBSERVE_MSG)


# ── AC-11: memory that evades VmData accounting is still killed (R2) ────────────────────────────
_SHARED_ANON_SRC = (
    "import mmap\n"
    "n = 400 * 1024 * 1024\n"
    "m = mmap.mmap(-1, n)\n"  # MAP_SHARED by default: outside data_vm, so RLIMIT_DATA never sees it
    "for off in range(0, n, 4096):\n    m[off] = 1\n" + _SPIN.format(n=60_000_000) + "result = 1"
)

_TOUCH_THEN_PROTECT_SRC = (
    "import ctypes, mmap\n"
    "libc = ctypes.CDLL(None, use_errno=True)\n"
    "libc.mprotect.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]\n"
    "size = 100 * 1024 * 1024\n"
    "keep = []\n"
    "for _ in range(6):\n"  # each map stays under the headroom, then leaves data_vm once read-only
    "    m = mmap.mmap(-1, size, flags=mmap.MAP_PRIVATE)\n"
    "    for off in range(0, size, 4096):\n        m[off] = 1\n"
    "    addr = ctypes.addressof(ctypes.c_char.from_buffer(m))\n"
    "    assert libc.mprotect(addr, size, 1) == 0\n"  # PROT_READ
    "    keep.append(m)\n" + _SPIN.format(n=60_000_000) + "result = 1"
)

# Production default imports only: ctypes is imported at the top of the wrapper, so a formula with
# no imports of its own reaches CDLL through object.__subclasses__() and maps shared memory.
_TRAVERSAL_SRC = (
    "CDLL = [c for c in object.__subclasses__() if c.__name__ == 'CDLL'][0]\n"
    "g = CDLL.__init__.__globals__\n"
    "libc = CDLL(None)\n"
    "libc.mmap.restype = g['c_void_p']\n"
    "libc.mmap.argtypes = [g['c_void_p'], g['c_size_t'], g['c_int'], g['c_int'], g['c_int'],\n"
    "                      g['c_long']]\n"
    "n = 400 * 1024 * 1024\n"
    "addr = libc.mmap(None, n, 3, 0x21, -1, 0)\n"  # PROT_READ|WRITE, MAP_SHARED|MAP_ANONYMOUS
    "g['memset'](addr, 1, n)\n" + _SPIN.format(n=60_000_000) + "result = 1"
)


@pytest.mark.parametrize(
    "src,allowed",
    [
        (_SHARED_ANON_SRC, ("mmap", "math")),
        (_TOUCH_THEN_PROTECT_SRC, ("ctypes", "mmap", "math")),
        (_TRAVERSAL_SRC, ("numpy", "pandas", "math", "statistics")),
    ],
    ids=["shared-anonymous-map", "touch-then-mprotect", "production-default-traversal"],
)
def test_ac11_vmdata_evading_memory_is_killed_by_the_resident_rule(src, allowed):
    res = _run(src, allowed=allowed)
    assert res.exit_reason == "memory_exceeded", (res.exit_reason, res.error, res.stderr[-300:])


def test_ac11_a_runtime_that_reports_no_vmdata_is_still_covered(monkeypatch):
    _lift_kernel_cap(monkeypatch)
    real = sandbox._parse_status
    monkeypatch.setattr(
        sandbox,
        "_parse_status",
        lambda text: {k: v for k, v in real(text).items() if k != "VmData"},
    )
    src = "import numpy as np\na = np.ones(50_000_000)\n" + _SPIN.format(n=60_000_000)
    res = _run(src + "result = 1", allowed=("numpy", "math"))
    assert res.exit_reason == "memory_exceeded", (res.error, res.stderr[-300:])


# ── AC-12: armed values survive a forged write ──────────────────────────────────────────────────
def test_ac12_armed_thresholds_are_unchanged_by_a_forged_handoff_write(caplog):
    forge = (
        "import os\n"
        "for fd in range(3, 64):\n"
        "    try:\n        os.write(fd, b'H1 1 1 1\\n')\n    except OSError:\n        pass\n"
    )
    limits = []
    for body in ("import os\n", forge):
        with caplog.at_level(logging.DEBUG, logger=WATCHDOG_LOGGER):
            caplog.clear()
            res = _run(body + _SPIN.format(n=12_000_000) + "result = 1", allowed=("os",))
        assert res.success, res.error
        peaks = _peak_records(caplog)
        assert peaks, "the run armed"
        limits.append((peaks[-1].r1_limit, peaks[-1].r2_limit))
    assert limits[0][0] == limits[1][0]
    assert abs(limits[0][1] - limits[1][1]) < _MIB


# ── oom_score_adj ───────────────────────────────────────────────────────────────────────────────
class TestOomScoreAdj:
    def _run_fake(self, monkeypatch, pid):
        class _Proc:
            returncode = None

            def communicate(self, input=None, timeout=None):
                self.returncode = 0
                return ("__OUTPUT__:{}", "")

        _Proc.pid = pid
        monkeypatch.setattr("app.services.sandbox.subprocess.Popen", lambda *a, **k: _Proc())
        return sandbox.execute_formula("result = 1", {}, ["math"], timeout_ms=1000)

    def test_the_parent_raises_the_childs_oom_score(self, monkeypatch, tmp_path):
        monkeypatch.setattr(sandbox, "_PROC", str(tmp_path))
        (tmp_path / "4242").mkdir()
        (tmp_path / "4242" / "oom_score_adj").write_text("0")
        self._run_fake(monkeypatch, 4242)
        assert (tmp_path / "4242" / "oom_score_adj").read_text() == "1000"

    def test_an_unwritable_entry_warns_once_per_process(self, monkeypatch, tmp_path, caplog):
        monkeypatch.setattr(sandbox, "_PROC", str(tmp_path))
        (tmp_path / "4242" / "oom_score_adj").mkdir(parents=True)  # a directory: open() fails
        with caplog.at_level(logging.WARNING):
            self._run_fake(monkeypatch, 4242)
            self._run_fake(monkeypatch, 4242)
        warns = [r for r in caplog.records if "oom_score_adj" in r.getMessage()]
        assert len(warns) == 1

    def test_a_missing_process_is_silent(self, monkeypatch, tmp_path, caplog):
        monkeypatch.setattr(sandbox, "_PROC", str(tmp_path))
        with caplog.at_level(logging.WARNING):
            self._run_fake(monkeypatch, 4242)
        assert not [r for r in caplog.records if "oom_score_adj" in r.getMessage()]
