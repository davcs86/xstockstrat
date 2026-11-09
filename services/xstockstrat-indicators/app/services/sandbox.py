"""
Sandboxed Python formula execution engine.

Executes user-defined Python formulas in an OS-isolated subprocess (feature 209).
Timeout, memory cap, allowed imports, and the concurrency bound are sourced from xstockstrat-config:
  - sandbox.timeout_ms
  - sandbox.memory_bytes
  - sandbox.allowed_imports
  - sandbox.max_concurrent

Security model (defence in depth; even a `().__class__.__base__.__subclasses__()` language-guard
escape yields no lateral movement):
  - Subprocess isolation + secret-free env (`_sandbox_env`): the child inherits no service secret.
  - Distinct UID: the child drops to nobody (65534) when the parent is root, so a same-UID
    `process_vm_readv`/`/proc/<parent>/environ` read of the parent's secrets is blocked cross-UID.
  - seccomp-BPF allowlist (ERRNO(EPERM) default), loaded AFTER the numeric-lib import and right
    before the untrusted `exec`: the network family, execve/execveat, io_uring, ptrace,
    process_vm_*, pidfd_*, every file-open syscall (open/openat/openat2) and write-creating FS ops
    are absent → EPERM, so module-attribute traversal to the real `os` cannot read any file. Allowed
    modules' lazy attributes are resolved before the filter loads. Fails closed on compat
    ABIs (x86/x32 not added) and any unknown syscall.
  - Expanded rlimits: RLIMIT_DATA (memory: measured pre-lockdown VmData baseline + memory_bytes
    headroom), RLIMIT_CPU (CPU backstop), RLIMIT_NPROC (fork-bomb), RLIMIT_FSIZE=0 (no file
    writes), RLIMIT_NOFILE. RLIMIT_AS is deliberately NOT used (it rejects numpy/pandas virtual
    reservations — INDICATORS-2).
  - Write elimination: PYTHONDONTWRITEBYTECODE + HOME/TMPDIR=/nonexistent (no .pyc/cache writes).
  - Deterministic termination: start_new_session + killpg on timeout and on every exit (a
    fork()+sleep grandchild cannot survive to hold an NPROC slot).
  - Import whitelist + filtered __builtins__ (unchanged): only allowed_imports may be imported.
  - BLAS/OMP backends pinned to a single thread (see _THREAD_LIMIT_ENV).
"""

import json
import logging
import math
import os
import re
import signal
import subprocess
import sys
import textwrap
import threading
import time
from dataclasses import dataclass, field

from app import telemetry

log = logging.getLogger(__name__)

# BLAS/OMP thread counts must be pinned to 1 in the child env before numpy imports, else
# its per-core virtual-memory reservations overflow the sandbox cap and the import fails.
_THREAD_LIMIT_ENV = {
    "OPENBLAS_NUM_THREADS": "1",
    "OMP_NUM_THREADS": "1",
    "MKL_NUM_THREADS": "1",
    "NUMEXPR_NUM_THREADS": "1",
    "VECLIB_MAXIMUM_THREADS": "1",
}

# Distinct unprivileged identity the child drops to (nobody/nogroup, present in python:3.13-slim).
# A fixed constant of the jail: cross-UID isolation, not an operator tunable.
_SANDBOX_UID = 65534
_SANDBOX_GID = 65534

# Fail-closed: no parseable VmData line raises StopIteration/ValueError before the formula runs.
_VMDATA_PROBE = (
    "with open('/proc/self/status') as _st:\n"
    "    _baseline = next(int(_l.split()[1]) * 1024 for _l in _st if _l.startswith('VmData:'))\n"
)

# Shared by the formula wrapper and the startup probe child; no trailing newline (the wrapper
# template supplies it, keeping the rendered text byte-identical).
_DROP_UID = (
    "if os.geteuid() == 0:\n"
    f"    os.setgid({_SANDBOX_GID})\n"
    "    os.setgroups([])\n"
    f"    os.setuid({_SANDBOX_UID})"
)

# Child-to-parent arming line, written to an inherited pipe fd after setrlimit and before the
# seccomp load, then closed before exec. Deliberately has no exception handling: a failed
# open/write/parse crashes the child before exec. A missing Rss* line reads as 0 (`.get`), so a
# runtime that omits them still yields a well-formed line. `{fd}` is substituted with
# `.format(fd=...)`, hence the doubled braces.
_HANDOFF = (
    "_hs = {{}}\n"
    "with open('/proc/self/status') as _st:\n"
    "    for _l in _st:\n"
    "        _k, _, _v = _l.partition(':')\n"
    "        if _k in ('VmData', 'RssAnon', 'RssShmem'):\n"
    "            _hs[_k] = int(_v.split()[0]) * 1024\n"
    "os.write({fd}, ('H1 %d %d %d\\n' % (\n"
    "    resource.getrlimit(resource.RLIMIT_DATA)[0],\n"
    "    _hs.get('RssAnon', 0) + _hs.get('RssShmem', 0) - _hs.get('VmData', 0),\n"
    "    resource.getrlimit(resource.RLIMIT_STACK)[0],\n"
    ")).encode())\n"
    "os.close({fd})\n"
)

_HANDOFF_LINE = re.compile(r"H1 (-?[0-9]+) (-?[0-9]+) (-?[0-9]+)\n")
_STATUS_FIELDS = ("VmData", "RssAnon", "RssShmem")
# seccomp allowlist finalized empirically (strace of numpy/pandas compute). openat is deliberately
# absent: the language guard is bypassable via module attributes, so nothing may open a file.
# Default action is ERRNO(EPERM): anything absent here —
# the whole socket family, execve/execveat, io_uring_*, ptrace, process_vm_*, pidfd_*, and
# write-creating FS ops — fails closed. Loaded AFTER import, so this is the compute surface only.
_SECCOMP_ALLOW = (
    "read",
    "readv",
    "write",
    "writev",
    "close",
    "lseek",
    "fstat",
    "newfstatat",
    "statx",
    "getdents64",
    "mmap",
    "munmap",
    "mremap",
    "mprotect",
    "madvise",
    "brk",
    "mbind",
    "set_mempolicy",
    "get_mempolicy",
    "futex",
    "futex_waitv",
    "set_robust_list",
    "get_robust_list",
    "rseq",
    "sched_yield",
    "sched_getaffinity",
    "membarrier",
    "clone",
    "clone3",
    "rt_sigaction",
    "rt_sigprocmask",
    "rt_sigreturn",
    "rt_sigtimedwait",
    "sigaltstack",
    "restart_syscall",
    "tgkill",
    "clock_gettime",
    "clock_nanosleep",
    "nanosleep",
    "gettimeofday",
    "getrandom",
    "getpid",
    "gettid",
    "getuid",
    "geteuid",
    "getgid",
    "getegid",
    "prctl",
    "exit",
    "exit_group",
)


def _sandbox_env() -> dict[str, str]:
    """Minimal environment for the sandbox child process.

    The child executes untrusted user formula source, so it MUST NOT inherit this service's
    environment — DATABASE_URL, JWT_SECRET, CONFIG_SECRETS_ENCRYPTION_KEY,
    BROKER_ACCOUNTS_ENCRYPTION_KEY and any other secret. PYTHONPATH is preserved so the child
    resolves the same modules; _THREAD_LIMIT_ENV pins BLAS/OMP threads before numpy import.
    """
    return {
        "PYTHONPATH": os.environ.get("PYTHONPATH", ""),
        # Write elimination (feature 209): no .pyc caching, no writable HOME/TMPDIR — a compute-only
        # formula writes nothing, so RLIMIT_FSIZE=0 never trips on a legit path.
        "PYTHONDONTWRITEBYTECODE": "1",
        "HOME": "/nonexistent",
        "TMPDIR": "/nonexistent",
        **_THREAD_LIMIT_ENV,
    }


def _child_headroom(memory_bytes: int) -> int:
    """Headroom the child's RLIMIT_DATA is set from; identity in production.

    Test seam, and the only one: tests lift the kernel cap with it while the parent watchdog keeps
    enforcing the real `memory_bytes`, emulating a runtime that ignores RLIMIT_DATA.
    """
    return memory_bytes


def _parse_status(text: str) -> dict[str, int]:
    """Bytes for the VmData/RssAnon/RssShmem lines present in a /proc/<pid>/status text."""
    out: dict[str, int] = {}
    for line in text.splitlines():
        key, _, rest = line.partition(":")
        if key in _STATUS_FIELDS:
            parts = rest.split()
            if parts:
                try:
                    out[key] = int(parts[0]) * 1024
                except ValueError:
                    continue
    return out


def _parse_stat(text: str) -> tuple[str, int, int]:
    """(state, pgrp, starttime) from /proc/<pid>/stat, split after the LAST ')' (free-text comm)."""
    fields = text.rsplit(")", 1)[1].split()
    return fields[0], int(fields[2]), int(fields[19])


def _parse_handoff(line: str) -> tuple[int, int, int] | None:
    """(cap, r0, stack) from exactly `H1 <int> <int> <int>` + newline; anything else is None."""
    match = _HANDOFF_LINE.fullmatch(line)
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


_ONCE_LOCK = threading.Lock()
_ONCE_SEEN: set[str] = set()


def _first_time(key: str) -> bool:
    """True only on the first call per key in this process; workers are threads, hence the lock."""
    with _ONCE_LOCK:
        if key in _ONCE_SEEN:
            return False
        _ONCE_SEEN.add(key)
        return True


def _reset_once_flags() -> None:
    """Tests only: re-arm every once-per-process record."""
    with _ONCE_LOCK:
        _ONCE_SEEN.clear()


def _warn_unobservable_once() -> None:
    if _first_time("unobservable"):
        log.error("sandbox memory watchdog cannot observe child")
    telemetry.set_sandbox_memory_watchdog_observable(0)


# Fixed jail constants (209 @AC-6): the parent's sampling tick and the bound on the arming line.
_TICK_S = 0.05
_HANDOFF_MAX = 128
_monotonic = time.monotonic  # tests patch this alias, never the global `time`

_PENDING, _ARMED, _ABSENT, _MALFORMED = "pending", "armed", "absent", "malformed"


@dataclass(frozen=True)
class _Armed:
    cap: int  # the child's RLIMIT_DATA soft limit as it read it back
    base: int  # cap - child headroom: the child's measured pre-lockdown VmData baseline
    r0: int  # resident-minus-VmData at handoff time (the parent uses max(r0, 0))
    stack: int  # RLIMIT_STACK soft limit; -1 is RLIM_INFINITY


def _arm_from_handoff(line: str, hr: int) -> _Armed | None:
    """Arm from a well-formed line with a positive baseline; None for anything else."""
    parsed = _parse_handoff(line)
    if parsed is None:
        return None
    cap, r0, stack = parsed
    base = cap - hr
    if base <= 0:
        return None
    return _Armed(cap=cap, base=base, r0=r0, stack=stack)


class _HandoffReader:
    """Non-blocking reader of the child's single arming line; owns and closes its descriptor.

    Takes only the first complete line (bounded by `_HANDOFF_MAX`); a later line never re-arms.
    ABSENT means the pipe closed with nothing written (the formula never ran), which is silent.
    """

    def __init__(self, fd: int, hr: int) -> None:
        self._fd = fd
        self._hr = hr
        self._buf = b""
        self.state = _PENDING
        self.armed: _Armed | None = None

    def poll(self) -> str:
        while self.state == _PENDING:
            try:
                chunk = os.read(self._fd, _HANDOFF_MAX + 1)
            except BlockingIOError:
                return self.state
            except OSError:
                chunk = b""
            self._buf += chunk
            newline = self._buf.find(b"\n")
            if newline >= 0:
                self._resolve(self._buf[: newline + 1])
            elif len(self._buf) > _HANDOFF_MAX:
                self._malformed()
            elif not chunk:
                self._malformed() if self._buf else self._finish(_ABSENT)
        return self.state

    def _resolve(self, line: bytes) -> None:
        armed = None
        if len(line) <= _HANDOFF_MAX:
            armed = _arm_from_handoff(line.decode("ascii", "replace"), self._hr)
        if armed is None:
            self._malformed()
        else:
            self.armed = armed
            self._finish(_ARMED)

    def _malformed(self) -> None:
        self._finish(_MALFORMED)
        _warn_unobservable_once()

    def _finish(self, state: str) -> None:
        self.state = state
        self.close()

    def close(self) -> None:
        if self._fd >= 0:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = -1


# Module constants so tests can point the parent's /proc and cgroup reads at a synthetic tree.
_PROC = "/proc"
_OOM_EVENTS_PATH = "/sys/fs/cgroup/memory.events"
_MEMORY_ERROR = "formula exceeded the sandbox memory headroom"
_OK, _KILLED, _BLIND = "ok", "killed", "blind"


@dataclass
class _GroupState:
    """Per-run sampling state: the armed values, each member's VmData at first sight, the peaks."""

    armed: _Armed
    refs: dict[tuple[int, int], int] = field(default_factory=dict)
    peak_growth: int = 0
    peak_resident: int = 0


@dataclass(frozen=True)
class _Sample:
    growth: int | None  # R1 input; None when a running member reports no VmData
    resident: int | None  # R2 input; None when a running member reports no RssAnon
    blind: bool  # positive evidence the parent cannot observe the group


def _read_at(dirfd: int, name: str) -> str:
    fd = os.open(name, os.O_RDONLY, dir_fd=dirfd)
    try:
        chunks = []
        while True:
            block = os.read(fd, 65536)
            if not block:
                return b"".join(chunks).decode("ascii", "replace")
            chunks.append(block)
    finally:
        os.close(fd)


def _sample_group(leader_pid: int, state: _GroupState) -> _Sample:
    """Memory of the leader's process group, read parent-side through per-process dir fds.

    The leader counts in full against `base`; any other member counts only its VmData growth since
    it was first seen (a copy-on-write child adds about 0). Resident memory sums every live
    member. Zombies and processes that vanish mid-read contribute nothing and are never evidence
    of blindness.
    """
    try:
        names = os.listdir(_PROC)
    except OSError:
        return _Sample(None, None, True)
    growth = resident = 0
    vm_missing = anon_missing = blind = False
    for name in names:
        if not name.isdigit():
            continue
        pid = int(name)
        try:
            dirfd = os.open(f"{_PROC}/{name}", os.O_RDONLY | os.O_DIRECTORY)
        except PermissionError:
            blind = True
            continue
        except OSError:
            continue
        try:
            try:
                proc_state, pgrp, started = _parse_stat(_read_at(dirfd, "stat"))
                if pgrp != leader_pid or proc_state in ("Z", "X"):
                    continue
                fields = _parse_status(_read_at(dirfd, "status"))
            except PermissionError:
                blind = True
                continue
            except (OSError, ValueError, IndexError):
                continue  # exited mid-read, or not a stat we can parse
        finally:
            os.close(dirfd)
        vmdata, anon = fields.get("VmData"), fields.get("RssAnon")
        if vmdata is None and anon is None:
            blind = True
            continue
        if vmdata is None:
            vm_missing = True
        elif pid == leader_pid:
            growth += vmdata - state.armed.base
        else:
            growth += max(0, vmdata - state.refs.setdefault((pid, started), vmdata))
        if anon is None:
            anon_missing = True
        else:
            resident += anon + fields.get("RssShmem", 0)
    return _Sample(None if vm_missing else growth, None if anon_missing else resident, blind)


def _r2_limit(armed: _Armed, memory_bytes: int) -> int:
    """Resident ceiling: baseline + headroom + stack allowance + resident-but-not-VmData."""
    stack = armed.stack if armed.stack > 0 else 0  # -1 is RLIM_INFINITY
    return armed.base + memory_bytes + max(armed.r0, 0) + stack


def _over_budget(sample: _Sample, armed: _Armed, memory_bytes: int) -> bool:
    if sample.growth is not None and sample.growth > memory_bytes:
        return True
    return sample.resident is not None and sample.resident > _r2_limit(armed, memory_bytes)


def _watch(proc: subprocess.Popen, state: _GroupState, memory_bytes: int) -> str:
    """One sampling tick: kill the group on a breach (before reap), or report it cannot observe."""
    try:
        sample = _sample_group(proc.pid, state)
    except PermissionError:
        sample = _Sample(None, None, True)
    except Exception:  # noqa: BLE001 - a broken sampler must never fail the formula
        if _first_time("sampler_error"):
            log.exception("sandbox memory watchdog sampler failed")
        sample = _Sample(None, None, True)
    if sample.blind:
        _warn_unobservable_once()
        return _BLIND
    if sample.growth is not None:
        state.peak_growth = max(state.peak_growth, sample.growth)
    if sample.resident is not None:
        state.peak_resident = max(state.peak_resident, sample.resident)
    if _over_budget(sample, state.armed, memory_bytes):
        _killpg(proc)
        return _KILLED
    return _OK


def _oom_kill_count() -> int | None:
    """The cgroup v2 `oom_kill` counter, or None where it cannot be read."""
    try:
        with open(_OOM_EVENTS_PATH) as fh:
            for line in fh:
                key, _, value = line.partition(" ")
                if key == "oom_kill":
                    return int(value)
    except (OSError, ValueError):
        pass
    return None


def _oom_kill_rose(before: int | None) -> bool:
    after = _oom_kill_count()
    return before is not None and after is not None and after > before


def _set_oom_score_adj(pid: int) -> None:
    """Make a sandbox child, not the gRPC server, the OOM victim (root raises its score)."""
    try:
        with open(f"{_PROC}/{pid}/oom_score_adj", "w") as fh:
            fh.write("1000")
    except FileNotFoundError:
        pass
    except OSError as exc:
        if _first_time("oom_score_adj"):
            log.warning("sandbox oom_score_adj write failed: %s", exc)


_SAFE_BUILTINS = {
    "abs",
    "all",
    "any",
    "bool",
    "dict",
    "dir",
    "divmod",
    "enumerate",
    "filter",
    "float",
    "format",
    "frozenset",
    "getattr",
    "hasattr",
    "hash",
    "int",
    "isinstance",
    "issubclass",
    "iter",
    "len",
    "list",
    "map",
    "max",
    "min",
    "next",
    "object",
    "pow",
    "print",
    "range",
    "repr",
    "reversed",
    "round",
    "set",
    "slice",
    "sorted",
    "str",
    "sum",
    "tuple",
    "type",
    "zip",
}


@dataclass
class SandboxResult:
    success: bool
    output: dict
    stdout: str
    stderr: str
    execution_ms: int
    memory_used_bytes: int
    error: str
    exit_reason: str  # "success"|"timeout"|"memory_exceeded"|"runtime_error"|"import_blocked"


# stderr markers of a child allocation failure; OpenBLAS's abort carries no "MemoryError".
_MEMORY_EXHAUSTED_MARKERS = ("MemoryError", "OpenBLAS error: Memory allocation still failed")

# Restrict builtins via a fresh __builtins__ namespace, never by mutating the shared builtins
# module — that breaks the interpreter/import machinery (e.g. delattr, KeyError, locals).
_SANDBOX_WRAPPER = textwrap.dedent("""
import ctypes
import errno
import json
import os
import resource

# Guard imports: only modules in the allowed list may be imported by the formula.
_allowed = set({allowed_imports!r})
_real_import = __import__

def _safe_import(name, *args, **kwargs):
    base = name.split('.')[0]
    if base not in _allowed:
        raise ImportError(f"Import '{{name}}' is not allowed in sandbox")
    return _real_import(name, *args, **kwargs)

# Eagerly import every allowed module BEFORE the seccomp filter loads, so import-time syscalls
# (openat dir-walk, getdents64, statx, mbind, lazy dlopen) run unfiltered — the post-import filter
# then only needs the compute surface (feature 209 design §3).
for _m in _allowed:
    try:
        _mod = _real_import(_m)
    except Exception:
        continue
    # openat is denied after the filter loads, so resolve every lazily-imported attribute now
    # (numpy's fft/rec/ma/... load on first access) — a post-filter lazy import fails EPERM.
    for _lazy in [_n for _n in dir(_mod) if _n not in vars(_mod)]:
        try:
            getattr(_mod, _lazy)
        except Exception:
            pass

# Build a restricted __builtins__ for the formula. Keep the safe-callable subset,
# all exception/warning types (so formulas can raise/except), and dunder builtins
# such as __build_class__ (needed for class definitions). Everything else —
# open/eval/exec/compile/input/globals/locals/... — is left out, and __import__
# is replaced with the guarded version above.
import builtins as _builtins
_SAFE = set({safe_builtins!r})
_restricted_builtins = {{}}
for _name in dir(_builtins):
    _obj = getattr(_builtins, _name)
    if (
        _name in _SAFE
        or _name.startswith('__')
        or (isinstance(_obj, type) and issubclass(_obj, BaseException))
    ):
        _restricted_builtins[_name] = _obj
_restricted_builtins['__import__'] = _safe_import

# Pre-cache a usable temp dir BEFORE the RLIMIT_FSIZE=0 lockdown. numpy/pandas call
# tempfile.gettempdir() lazily during compute; it probes candidate dirs by WRITING a byte, which
# RLIMIT_FSIZE=0 then makes raise FileNotFoundError ("No usable temporary directory"). Caching it
# here (writes still allowed) makes later gettempdir() calls return the cached path with no write;
# RLIMIT_FSIZE=0 still blocks every real write, so the no-writable-FS guarantee is unchanged.
import tempfile as _tempfile
_tempfile.gettempdir()

# ── OS-isolation lockdown (feature 209): everything below runs BEFORE the untrusted exec ────────
# Drop to a distinct unprivileged UID when the parent is root (prod); no-op when already
# unprivileged (dev/CI). Cross-UID isolation is what blocks a parent-memory/secret read.
{drop_uid}

# NO_NEW_PRIVS: required for an unprivileged seccomp load; never disable (pyseccomp also sets it).
ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0)  # PR_SET_NO_NEW_PRIVS

# Import before RLIMIT_NPROC: pyseccomp's find_library forks ldconfig, which fails under the cap.
import pyseccomp as _seccomp

# RLIMIT_DATA (not RLIMIT_AS, INDICATORS-2) = pre-lockdown VmData baseline + memory_bytes headroom.
# CPU/NPROC derive from config; FSIZE=0/NOFILE=64 are jail constants.
{vmdata_probe}
if {memory_bytes} > 0:
    _cap = min(_baseline + {child_headroom}, 2**63 - 1)
    resource.setrlimit(resource.RLIMIT_DATA, (_cap, _cap))
{handoff}
resource.setrlimit(resource.RLIMIT_CPU, ({rlimit_cpu}, {rlimit_cpu}))
resource.setrlimit(resource.RLIMIT_NPROC, ({rlimit_nproc}, {rlimit_nproc}))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

# Parsed after the rlimits so payloads count against the formula headroom, not the baseline.
data = json.loads({input_json!r})
params = json.loads({params_json!r})

# seccomp-BPF allowlist: ERRNO(EPERM) default; native arch only (compat x86/x32 NOT added → they
# fail closed to EPERM). The network/exec/io_uring/ptrace/process_vm/pidfd families are absent.
_flt = _seccomp.SyscallFilter(defaction=_seccomp.ERRNO(errno.EPERM))
for _sc in {seccomp_allow!r}:
    try:
        _flt.add_rule(_seccomp.ALLOW, _sc)
    except Exception:
        pass  # a name unknown to the host libseccomp is inert to ALLOW; the image validates the set
_flt.load()
# ── lockdown complete ───────────────────────────────────────────────────────────────────────────

# ── User formula begins ──────────────────────────────────────────────────────
_formula_globals = {{'__builtins__': _restricted_builtins, 'data': data, 'params': params}}
exec({source!r}, _formula_globals)
# ── User formula ends ────────────────────────────────────────────────────────

# Output must be assigned to `result` variable
_output = _formula_globals.get('result', {{}})
print("\\n__OUTPUT__:" + json.dumps(_output if isinstance(_output, dict) else {{"value": _output}}))
""")


def _killpg(proc: subprocess.Popen) -> None:
    """SIGKILL the child's whole process group so a forked grandchild cannot survive (design §5).

    Load-bearing for the RLIMIT_NPROC bound: a fork()+sleep(inf) grandchild evades the direct-child
    kill and RLIMIT_CPU, and would hold a uid-65534 process slot forever (a permanent @AC-5 DoS).
    """
    if proc.returncode is not None:
        return  # already reaped: its pid may belong to someone else now
    try:
        os.killpg(proc.pid, signal.SIGKILL)  # start_new_session: the pgid is the leader's pid
    except (ProcessLookupError, PermissionError):
        pass


def execute_formula(
    source: str,
    input_data: dict,
    allowed_imports: list[str],
    timeout_ms: int = 5000,
    memory_bytes: int = 128 * 1024 * 1024,
    params: dict | None = None,
    max_concurrent: int = 4,
    grace_ms: int = 5000,
) -> SandboxResult:
    """
    Execute formula source in an OS-isolated subprocess with resource limits.
    Returns SandboxResult regardless of outcome. ``max_concurrent`` derives the per-UID RLIMIT_NPROC
    fork-bomb bound; callers pass max(live limit, slots in use) so a shrink never under-provisions
    the children still running (F-07).
    """
    # Derived rlimits: CPU = wall deadline + 2s slack (so the wall clock, not SIGXCPU, ends a
    # runaway as "timeout"); NPROC = concurrency x per-child budget.
    deadline_ms = timeout_ms + grace_ms
    rlimit_cpu = math.ceil(deadline_ms / 1000) + 2
    rlimit_nproc = max_concurrent * 16

    hr = _child_headroom(memory_bytes)
    # The arming pipe exists only when a cap is set; the child reports its cap on it, then closes.
    w = -1
    reader = None
    if memory_bytes > 0:
        r, w = os.pipe()
        os.set_blocking(r, False)
        reader = _HandoffReader(r, hr)
    try:
        wrapped = _SANDBOX_WRAPPER.format(
            memory_bytes=memory_bytes,
            child_headroom=hr,
            safe_builtins=sorted(_SAFE_BUILTINS),
            allowed_imports=allowed_imports,
            input_json=json.dumps(input_data),
            params_json=json.dumps(params or {}),
            source=source,
            drop_uid=_DROP_UID,
            rlimit_cpu=rlimit_cpu,
            rlimit_nproc=rlimit_nproc,
            seccomp_allow=_SECCOMP_ALLOW,
            vmdata_probe=_VMDATA_PROBE,
            handoff=_HANDOFF.format(fd=w) if w >= 0 else "",
        )

        # Source is fed on stdin (an inherited fd, UID-independent): no /tmp script the nobody
        # child could not read, and no sibling-readable formula file (design §2).
        oom_before = _oom_kill_count()
        start = _monotonic()
        try:
            proc = subprocess.Popen(
                [sys.executable, "-"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=_sandbox_env(),
                start_new_session=True,
                pass_fds=(w,) if w >= 0 else (),
            )
        finally:
            if w >= 0:
                os.close(w)
        _set_oom_score_adj(proc.pid)
        deadline = start + deadline_ms / 1000
        gstate: _GroupState | None = None
        watching = False
        killed_for_memory = False
        try:
            data = wrapped
            while True:
                try:
                    stdout, stderr = proc.communicate(
                        input=data, timeout=max(0.0, min(_TICK_S, deadline - _monotonic()))
                    )
                    break
                except subprocess.TimeoutExpired:
                    data = None  # the script is already sent; communicate() resumes where it was
                    if reader is not None:
                        reader.poll()
                        if reader.state == _ARMED and gstate is None:
                            gstate = _GroupState(reader.armed)
                            watching = True
                    if watching and not killed_for_memory:
                        outcome = _watch(proc, gstate, memory_bytes)
                        killed_for_memory = outcome == _KILLED
                        watching = outcome == _OK
                    if _monotonic() < deadline:
                        continue
                    _killpg(proc)
                    out, err = proc.communicate()  # reap the killed child
                    if killed_for_memory:  # the watchdog fired first: memory wins over the timeout
                        return SandboxResult(
                            success=False,
                            output={},
                            stdout=out or "",
                            stderr=err or "",
                            execution_ms=int((_monotonic() - start) * 1000),
                            memory_used_bytes=0,
                            error=_MEMORY_ERROR,
                            exit_reason="memory_exceeded",
                        )
                    return SandboxResult(
                        success=False,
                        output={},
                        stdout="",
                        stderr="",
                        execution_ms=timeout_ms,
                        memory_used_bytes=0,
                        error=f"Formula execution timed out after {timeout_ms}ms",
                        exit_reason="timeout",
                    )

            elapsed_ms = int((_monotonic() - start) * 1000)

            def _fail(error: str, exit_reason: str) -> SandboxResult:
                return SandboxResult(
                    success=False,
                    output={},
                    stdout=stdout,
                    stderr=stderr,
                    execution_ms=elapsed_ms,
                    memory_used_bytes=0,
                    error=error,
                    exit_reason=exit_reason,
                )

            if killed_for_memory:
                return _fail(_MEMORY_ERROR, "memory_exceeded")

            marker = None
            for line in stdout.splitlines():
                if line.startswith("__OUTPUT__:"):
                    marker = line[len("__OUTPUT__:") :]

            if proc.returncode != 0:
                exit_reason = "runtime_error"
                if "is not allowed in sandbox" in stderr:
                    exit_reason = "import_blocked"
                elif any(m in stderr for m in _MEMORY_EXHAUSTED_MARKERS):
                    exit_reason = "memory_exceeded"
                elif proc.returncode == -signal.SIGKILL and _oom_kill_rose(oom_before):
                    exit_reason = "memory_exceeded"  # the cgroup OOM killer, by counter evidence
                return _fail(
                    stderr.strip()[-500:]
                    or f"formula exited with code {proc.returncode} before producing output",
                    exit_reason,
                )

            if marker is None:
                return _fail("formula produced no output", "runtime_error")
            try:
                output = json.loads(marker)
            except json.JSONDecodeError as e:
                return _fail(f"formula output could not be parsed: {e}", "runtime_error")

            return SandboxResult(
                success=True,
                output=output,
                stdout=stdout,
                stderr=stderr,
                execution_ms=elapsed_ms,
                memory_used_bytes=0,
                error="",
                exit_reason="success",
            )
        finally:
            if gstate is not None:
                limits = (memory_bytes, _r2_limit(gstate.armed, memory_bytes))
                log.debug(
                    "sandbox watchdog peak peak_vmdata_growth=%d peak_resident=%d "
                    "r1_limit=%d r2_limit=%d",
                    gstate.peak_growth,
                    gstate.peak_resident,
                    *limits,
                    extra={
                        "peak_vmdata_growth": gstate.peak_growth,
                        "peak_resident": gstate.peak_resident,
                        "r1_limit": limits[0],
                        "r2_limit": limits[1],
                    },
                )
            # No-op once the leader is reaped (its pid is no longer ours); the kill-before-reap
            # paths above are what remove a lingering grandchild group.
            _killpg(proc)
    finally:
        if reader is not None:
            reader.close()
