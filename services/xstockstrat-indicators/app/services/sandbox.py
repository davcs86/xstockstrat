"""
Sandboxed Python formula execution engine.

Executes user-defined Python formulas in an OS-isolated subprocess (feature 209).
Timeout, memory cap, allowed imports, and the concurrency bound are sourced from xstockstrat-config:
  - indicators.sandbox.timeout_ms
  - indicators.sandbox.memory_bytes
  - indicators.sandbox.allowed_imports
  - indicators.sandbox.max_concurrent

Security model (defence in depth; even a `().__class__.__base__.__subclasses__()` language-guard
escape yields no lateral movement):
  - Subprocess isolation + secret-free env (`_sandbox_env`): the child inherits no service secret.
  - Distinct UID: the child drops to nobody (65534) when the parent is root, so a same-UID
    `process_vm_readv`/`/proc/<parent>/environ` read of the parent's secrets is blocked cross-UID.
  - seccomp-BPF allowlist (ERRNO(EPERM) default), loaded AFTER the numeric-lib import and right
    before the untrusted `exec`: the network family, execve/execveat, io_uring, ptrace,
    process_vm_*, pidfd_*, and write-creating FS ops are absent → EPERM. Fails closed on compat
    ABIs (x86/x32 not added) and any unknown syscall.
  - Expanded rlimits: RLIMIT_DATA (memory), RLIMIT_CPU (CPU backstop), RLIMIT_NPROC (fork-bomb),
    RLIMIT_FSIZE=0 (no file writes), RLIMIT_NOFILE. RLIMIT_AS is deliberately NOT used (it rejects
    numpy/pandas virtual reservations — INDICATORS-2).
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
import signal
import subprocess
import sys
import textwrap
from dataclasses import dataclass

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

# seccomp allowlist finalized empirically (strace of numpy/pandas compute) + defensive read-path
# members for the runtime-image glibc. Default action is ERRNO(EPERM): anything absent here —
# the whole socket family, execve/execveat, io_uring_*, ptrace, process_vm_*, pidfd_*, and
# write-creating FS ops — fails closed. Loaded AFTER import, so this is the compute surface only.
_SECCOMP_ALLOW = (
    "openat",
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
        _real_import(_m)
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

# Load input data
data = json.loads({input_json!r})

# Load validated parameter values (separate namespace from `data`)
params = json.loads({params_json!r})

# ── OS-isolation lockdown (feature 209): everything below runs BEFORE the untrusted exec ────────
# Drop to a distinct unprivileged UID when the parent is root (prod); no-op when already
# unprivileged (dev/CI). Cross-UID isolation is what blocks a parent-memory/secret read.
if os.geteuid() == 0:
    os.setgid({sandbox_gid})
    os.setgroups([])
    os.setuid({sandbox_uid})

# NO_NEW_PRIVS: required for an unprivileged seccomp load; never disable (pyseccomp also sets it).
ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0)  # PR_SET_NO_NEW_PRIVS

# Expanded rlimits. RLIMIT_DATA (heap + anon mmap) not RLIMIT_AS — numpy/pandas reserve huge virtual
# space on import that RLIMIT_AS would reject before any real use (INDICATORS-2). CPU/NPROC derive
# from config (timeout_ms/max_concurrent); FSIZE=0/NOFILE=64 are jail constants.
if {memory_bytes} > 0:
    resource.setrlimit(resource.RLIMIT_DATA, ({memory_bytes}, {memory_bytes}))
resource.setrlimit(resource.RLIMIT_CPU, ({rlimit_cpu}, {rlimit_cpu}))
resource.setrlimit(resource.RLIMIT_NPROC, ({rlimit_nproc}, {rlimit_nproc}))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

# seccomp-BPF allowlist: ERRNO(EPERM) default; native arch only (compat x86/x32 NOT added → they
# fail closed to EPERM). The network/exec/io_uring/ptrace/process_vm/pidfd families are absent.
import pyseccomp as _seccomp
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
print("__OUTPUT__:" + json.dumps(_output if isinstance(_output, dict) else {{"value": _output}}))
""")


def _killpg(proc: subprocess.Popen) -> None:
    """SIGKILL the child's whole process group so a forked grandchild cannot survive (design §5).

    Load-bearing for the RLIMIT_NPROC bound: a fork()+sleep(inf) grandchild evades the direct-child
    kill and RLIMIT_CPU, and would hold a uid-65534 process slot forever (a permanent @AC-5 DoS).
    """
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
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
) -> SandboxResult:
    """
    Execute formula source in an OS-isolated subprocess with resource limits.
    Returns SandboxResult regardless of outcome. ``max_concurrent`` derives the per-UID RLIMIT_NPROC
    fork-bomb bound from live config (F-07), so it scales with the sandbox concurrency semaphore.
    """
    import time

    # Derived rlimits: CPU = wall-timeout + 2s slack; NPROC = concurrency x per-child budget.
    rlimit_cpu = math.ceil(timeout_ms / 1000) + 2
    rlimit_nproc = max_concurrent * 16

    wrapped = _SANDBOX_WRAPPER.format(
        memory_bytes=memory_bytes,
        safe_builtins=sorted(_SAFE_BUILTINS),
        allowed_imports=allowed_imports,
        input_json=json.dumps(input_data),
        params_json=json.dumps(params or {}),
        source=source,
        sandbox_uid=_SANDBOX_UID,
        sandbox_gid=_SANDBOX_GID,
        rlimit_cpu=rlimit_cpu,
        rlimit_nproc=rlimit_nproc,
        seccomp_allow=_SECCOMP_ALLOW,
    )

    # Source is fed on stdin (an inherited fd, UID-independent) — no /tmp script the nobody child
    # could not read, and no sibling-readable formula file (design §2).
    start = time.monotonic()
    proc = subprocess.Popen(
        [sys.executable, "-"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=_sandbox_env(),
        start_new_session=True,
    )
    try:
        try:
            stdout, stderr = proc.communicate(input=wrapped, timeout=timeout_ms / 1000)
        except subprocess.TimeoutExpired:
            _killpg(proc)
            proc.communicate()  # reap the killed child
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

        elapsed_ms = int((time.monotonic() - start) * 1000)

        output = {}
        for line in stdout.splitlines():
            if line.startswith("__OUTPUT__:"):
                try:
                    output = json.loads(line[len("__OUTPUT__:") :])
                except json.JSONDecodeError:
                    pass

        if proc.returncode != 0:
            exit_reason = "runtime_error"
            if "is not allowed in sandbox" in stderr:
                exit_reason = "import_blocked"
            elif "MemoryError" in stderr:
                exit_reason = "memory_exceeded"
            return SandboxResult(
                success=False,
                output={},
                stdout=stdout,
                stderr=stderr,
                execution_ms=elapsed_ms,
                memory_used_bytes=0,
                error=stderr.strip()[-500:],
                exit_reason=exit_reason,
            )

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
        # Reap any lingering grandchild group even on the success/error paths (design §5).
        _killpg(proc)
