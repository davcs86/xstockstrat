"""Startup probe (feature 300 FR-2): is RLIMIT_DATA kernel-enforced here, and can the parent
watch a child?

Runs once at boot in the parent, never inside a formula, and never raises or stops startup. A
trusted child sets a known cap, hands its cap back over an inherited pipe, then grows memory
under the parent's eye. Two label-free gauges and one INFO line record the outcome; the service
always keeps serving.

Fixed jail constants (not config keys, 209 @AC-6): the timeout, the movement threshold, the probe
headroom and the two map sizes below.
"""

import logging
import os
import resource
import selectors
import signal
import subprocess
import sys
import time

from app import telemetry
from app.services.sandbox import (
    _DROP_UID,
    _HANDOFF,
    _VMDATA_PROBE,
    _child_headroom,
    _parse_handoff,
    _parse_status,
    _sandbox_env,
    _warn_unobservable_once,
)

log = logging.getLogger(__name__)

_MIB = 1024 * 1024
_PROBE_TIMEOUT_S = 15
_PROBE_MOVE_MIN = 8 * _MIB
_PROBE_HEADROOM = 64 * _MIB
_STEP_A = 16 * _MIB
_STEP_B = 256 * _MIB

_CGROUP_MEMORY_MAX = ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes")
_CGROUP_V2_EVENTS = "/sys/fs/cgroup/memory.events"

# Template for the probe child; `{fd}` and the other names are filled by str.format, so any literal
# brace must be doubled. The child imports numpy first, as root, like the formula wrapper does.
_PROBE_SCRIPT = """\
import errno
import mmap
import os
import resource
import sys

import numpy as np

{drop_uid}
{vmdata_probe}
_cap = _baseline + {headroom}
resource.setrlimit(resource.RLIMIT_DATA, (_cap, _cap))
{handoff}
print('set', _cap, flush=True)
print('s0', flush=True)
sys.stdin.readline()
_m = mmap.mmap(-1, {step_a}, flags=mmap.MAP_PRIVATE)
for _i in range(0, {step_a}, 4096):
    _m[_i] = 1
print('s1', flush=True)
sys.stdin.readline()
_m.close()


def _refused(fn):
    try:
        fn()
    except MemoryError:
        return 1
    except OSError as e:
        if e.errno == errno.ENOMEM:
            return 1
        raise
    return 0


def _leg_mmap():
    mmap.mmap(-1, {step_b}, flags=mmap.MAP_PRIVATE).close()


def _leg_mremap():
    mm = mmap.mmap(-1, {step_a}, flags=mmap.MAP_PRIVATE)
    try:
        mm.resize({step_b})
    finally:
        mm.close()


def _leg_numpy():
    a = np.zeros(1)
    a.resize({step_b} // 8, refcheck=False)


print('legs', _refused(_leg_mmap), _refused(_leg_mremap), _refused(_leg_numpy), flush=True)
"""


class _ProbeFailed(Exception):
    """The probe child crashed, timed out, or spoke out of protocol."""


class _Reader:
    """Line reader over a raw fd: selector wait + os.read, a private buffer, a hard deadline."""

    def __init__(self, fd: int) -> None:
        self._fd = fd
        self._buf = b""
        self._eof = False
        self._sel = selectors.DefaultSelector()
        self._sel.register(fd, selectors.EVENT_READ)

    def line(self, deadline: float) -> str:
        while b"\n" not in self._buf:
            if self._eof:
                raise _ProbeFailed("child closed its pipe before a complete line")
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self._sel.select(remaining):
                raise _ProbeFailed("timed out waiting for the probe child")
            chunk = os.read(self._fd, 4096)
            if chunk:
                self._buf += chunk
            else:
                self._eof = True
        raw, _, self._buf = self._buf.partition(b"\n")
        return raw.decode(errors="replace")

    def close(self) -> None:
        self._sel.close()


def _sample(pid: int) -> dict[str, int]:
    """Memory fields of one process; the parent reads a child that may run as another uid."""
    with open(f"/proc/{pid}/status") as fh:
        return _parse_status(fh.read())


def _try_sample(pid: int) -> tuple[dict[str, int], bool]:
    try:
        return _sample(pid), False
    except PermissionError:
        return {}, True


def _words(line: str, tag: str, count: int) -> list[int]:
    parts = line.split()
    if len(parts) != count + 1 or parts[0] != tag:
        raise _ProbeFailed(f"unexpected {tag!r} line: {line[:80]!r}")
    try:
        return [int(p) for p in parts[1:]]
    except ValueError as exc:
        raise _ProbeFailed(f"non-integer in {tag!r} line: {line[:80]!r}") from exc


def _expect(reader: _Reader, deadline: float, tag: str) -> None:
    got = reader.line(deadline)
    if got != tag:
        raise _ProbeFailed(f"expected {tag!r}, got {got[:80]!r}")


def _read_text(path: str) -> str | None:
    try:
        with open(path) as fh:
            return fh.read().strip()
    except OSError:
        return None


def _memory_max() -> str:
    for path in _CGROUP_MEMORY_MAX:
        text = _read_text(path)
        if text is not None:
            return text
    return "absent"


def _oom_kill_readable() -> bool:
    text = _read_text(_CGROUP_V2_EVENTS)
    return text is not None and any(line.startswith("oom_kill ") for line in text.splitlines())


def _stop(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def _probe() -> dict:
    hr = _child_headroom(_PROBE_HEADROOM)
    r, w = os.pipe()
    proc = None
    readers: list[_Reader] = []
    try:
        script = _PROBE_SCRIPT.format(
            fd=w,
            headroom=hr,
            step_a=_STEP_A,
            step_b=_STEP_B,
            drop_uid=_DROP_UID,
            vmdata_probe=_VMDATA_PROBE,
            handoff=_HANDOFF.format(fd=w),
        )
        proc = subprocess.Popen(
            [sys.executable, "-c", script],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=0,
            pass_fds=(w,),
            env=_sandbox_env(),
            start_new_session=True,
        )
        os.close(w)
        w = -1
        deadline = time.monotonic() + _PROBE_TIMEOUT_S
        out = _Reader(proc.stdout.fileno())
        hand = _Reader(r)
        readers += [out, hand]

        cap_set = _words(out.line(deadline), "set", 1)[0]
        handoff = _parse_handoff(hand.line(deadline) + "\n")
        if handoff is None:
            raise _ProbeFailed("malformed handoff line")
        _expect(out, deadline, "s0")
        s0, denied0 = _try_sample(proc.pid)
        proc.stdin.write(b"\n")
        _expect(out, deadline, "s1")
        s1, denied1 = _try_sample(proc.pid)
        oom_score_adj = _read_text(f"/proc/{proc.pid}/oom_score_adj") or "absent"
        proc.stdin.write(b"\n")
        legs = _words(out.line(deadline), "legs", 3)
        if any(leg not in (0, 1) for leg in legs):
            raise _ProbeFailed(f"leg result out of range: {legs}")
    finally:
        for reader in readers:
            reader.close()
        if proc is not None:
            _stop(proc)
        os.close(r)
        if w >= 0:
            os.close(w)

    def delta(key: str):
        return s1[key] - s0[key] if key in s0 and key in s1 else None

    vmdata_delta = delta("VmData")
    cap_read = handoff[0]
    return {
        "cap_set": cap_set,
        "cap_read": cap_read,
        "vmdata_delta": vmdata_delta,
        "rssanon_delta": delta("RssAnon"),
        "probe_rss": s1.get("RssAnon", 0) + s1.get("RssShmem", 0) if s1 else "n/a",
        "oom_score_adj": oom_score_adj,
        "legs": legs,
        "enforced": legs == [1, 1, 1],
        "observable": (
            cap_read == cap_set
            and vmdata_delta is not None
            and vmdata_delta >= _PROBE_MOVE_MIN
            and not (denied0 or denied1)
        ),
    }


def _report(result: dict) -> None:
    uname = os.uname()
    log.info(
        "sandbox memory probe uname=%r proc_version=%r memory_max=%s rlimit_data_hard=%s "
        "cap_set=%s cap_read=%s vmdata_delta=%s rssanon_delta=%s probe_rss=%s oom_score_adj=%s "
        "oom_kill_readable=%s legs=%s enforced=%s observable=%s",
        f"{uname.sysname} {uname.release} {uname.machine}",
        _read_text("/proc/version") or "absent",
        _memory_max(),
        resource.getrlimit(resource.RLIMIT_DATA)[1],
        result["cap_set"],
        result["cap_read"],
        result["vmdata_delta"],
        result["rssanon_delta"],
        result["probe_rss"],
        result["oom_score_adj"],
        _oom_kill_readable(),
        "/".join(str(leg) for leg in result["legs"]),
        result["enforced"],
        result["observable"],
    )
    telemetry.set_sandbox_memory_cap_enforced(1 if result["enforced"] else 0)
    if not result["enforced"]:
        log.error("sandbox memory cap not kernel-enforced")
    if result["observable"]:
        telemetry.set_sandbox_memory_watchdog_observable(1)
    else:
        _warn_unobservable_once()


def run_startup_probe() -> None:
    """Probe the runtime once; any failure is logged and both gauges read 0. Never raises."""
    try:
        try:
            result = _probe()
        except Exception as exc:  # noqa: BLE001 - the probe must never stop startup
            log.error("sandbox memory probe failed: %s", exc)
            telemetry.set_sandbox_memory_cap_enforced(0)
            telemetry.set_sandbox_memory_watchdog_observable(0)
            return
        _report(result)
    except Exception:  # noqa: BLE001
        log.exception("sandbox memory probe reporting failed")
