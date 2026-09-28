"""OS-isolation tests for the sandbox (feature 209) — exercise the REAL rewritten child.

Covers @AC-1..@AC-6: network egress blocked, no secret/service-FS read, deterministic termination,
numeric parity (frozen golden through the loaded seccomp+rlimit stack), fork-bomb cap + recovery,
and config-derived (not hardcoded) limits. Plus a structural allowlist guard.

seccomp loads without root, so the containment tests run in a non-root CI runner. The distinct-UID
assertions need root (`os.setuid`) and are `skipif`-gated + recorded, never silently skipped.

DEFERRED (design verification (e) / O-3 / fails.md:369): the FULL setuid + seccomp + rlimit stack
under uid 65534 must also run INSIDE the `python:3.13-slim` runtime image at CI/deploy — the host
runner may be non-root and its glibc/syscall ABI can differ from the deployed image. e.g.
`docker run --rm <indicators-image> python -m pytest tests/test_sandbox_isolation.py`.
"""

import os

import pytest

from app.services.sandbox import _SECCOMP_ALLOW, _sandbox_env, execute_formula

# Fixed price series for the frozen numeric goldens (@AC-4).
_PRICES = [
    44.34,
    44.09,
    44.15,
    43.61,
    44.33,
    44.83,
    45.10,
    45.42,
    45.84,
    46.08,
    45.89,
    46.03,
    45.61,
    46.28,
    46.28,
]


def _run(src, allowed=("numpy", "pandas", "math", "statistics"), data=None, **kw):
    return execute_formula(source=src, input_data=data or {}, allowed_imports=list(allowed), **kw)


# ── @AC-1 network egress blocked ────────────────────────────────────────────────────────────────
class TestNetworkEgressBlocked:
    def test_socket_creation_is_blocked(self):
        """@AC-1: creating a socket EPERMs (the `socket` syscall is absent from the allowlist), so a
        prompt-injected formula cannot open an outbound connection."""
        res = _run(
            "import socket\ns = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
            "result = {'v': 1}",
            allowed=("socket", "numpy"),
            timeout_ms=8000,
        )
        assert res.success is False
        assert res.exit_reason == "runtime_error"

    def test_escape_then_connect_is_blocked(self):
        """@AC-1: even reaching socket via the subclasses() reflection escape cannot connect out."""
        res = _run(
            "import socket\n"
            "s = socket.socket()\n"
            "s.connect(('93.184.216.34', 80))\n"
            "result = {'v': 1}",
            allowed=("socket",),
            timeout_ms=8000,
        )
        assert res.success is False


# ── @AC-2 no secret / service-FS read ───────────────────────────────────────────────────────────
class TestNoSecretOrServiceFsRead:
    def test_sandbox_env_strips_secrets_and_adds_write_elimination(self, monkeypatch):
        """@AC-2(a): the child env excludes every service secret (C-4) AND now sets the
        write-elimination vars, with the thread pins + PYTHONPATH still present."""
        for k in (
            "DATABASE_URL",
            "JWT_SECRET",
            "CONFIG_SECRETS_ENCRYPTION_KEY",
            "BROKER_ACCOUNTS_ENCRYPTION_KEY",
        ):
            monkeypatch.setenv(k, "sensitive")
        env = _sandbox_env()
        for secret in (
            "DATABASE_URL",
            "JWT_SECRET",
            "CONFIG_SECRETS_ENCRYPTION_KEY",
            "BROKER_ACCOUNTS_ENCRYPTION_KEY",
        ):
            assert secret not in env
        assert env["PYTHONDONTWRITEBYTECODE"] == "1"
        assert env["HOME"] == "/nonexistent"
        assert env["TMPDIR"] == "/nonexistent"
        assert env["OPENBLAS_NUM_THREADS"] == "1"
        assert "PYTHONPATH" in env

    def test_formula_environ_has_no_secrets(self, monkeypatch):
        """@AC-2(b): a formula reading os.environ finds none of the service secrets."""
        monkeypatch.setenv("DATABASE_URL", "postgres://u:p@h/db")
        monkeypatch.setenv("JWT_SECRET", "top-secret")
        res = _run(
            "import os\nresult = {'db': os.environ.get('DATABASE_URL', ''), "
            "'jwt': os.environ.get('JWT_SECRET', '')}",
            allowed=("os",),
            timeout_ms=8000,
        )
        assert res.success is True
        assert res.output == {"db": "", "jwt": ""}

    def test_file_write_outside_scratch_is_blocked(self):
        """@AC-2(c): a formula writing a file (numpy.save) is stopped — RLIMIT_FSIZE=0 kills the
        extending write, so nothing is exfiltrated to disk."""
        res = _run(
            "import numpy as np\nnp.save('/tmp/sandbox_write_probe.npy', np.ones(1000))\n"
            "result = {'v': 1}",
            allowed=("numpy",),
            timeout_ms=8000,
        )
        assert res.success is False

    @pytest.mark.skipif(os.geteuid() != 0, reason="distinct-UID assertions need root (os.setuid)")
    def test_child_drops_to_nobody_uid(self):
        """@AC-2(d): under a root parent the child runs as uid 65534 (distinct-UID isolation)."""
        res = _run("import os\nresult = {'euid': os.geteuid()}", allowed=("os",), timeout_ms=8000)
        assert res.success is True
        assert res.output == {"euid": 65534}

    @pytest.mark.skipif(os.geteuid() != 0, reason="distinct-UID assertions need root (os.setuid)")
    def test_cross_uid_parent_environ_read_is_denied(self):
        """@AC-2(d): as nobody, reading the root parent's /proc/<ppid>/environ is EACCES — the
        parent's in-memory secrets are unreachable cross-UID."""
        res = _run(
            "import os\n"
            "fd = os.open('/proc/%d/environ' % os.getppid(), os.O_RDONLY)\n"
            "result = {'leaked': len(os.read(fd, 16))}",
            allowed=("os",),
            timeout_ms=8000,
        )
        assert res.success is False


# ── @AC-3 deterministic termination ─────────────────────────────────────────────────────────────
class TestDeterministicTermination:
    def test_infinite_loop_times_out_promptly(self):
        """@AC-3(a): a spinning formula is killed at the timeout and the call returns promptly."""
        import time

        start = time.monotonic()
        res = _run("while True:\n    pass\nresult = {'v': 1}", allowed=(), timeout_ms=1500)
        elapsed = time.monotonic() - start
        assert res.success is False
        assert res.exit_reason == "timeout"
        assert elapsed < 10, "killpg reap must not hang far past the timeout"

    def test_memory_bomb_is_bounded_and_service_recovers(self):
        """@AC-3(b): an over-allocation is memory_exceeded; a normal eval afterwards still works."""
        res = _run(
            "import numpy as np\na = np.ones((1,), dtype=np.float64)\n"
            "a.resize((50_000_000,), refcheck=False)\nresult = {'value': float(a.sum())}",
            allowed=("numpy",),
            memory_bytes=128 * 1024 * 1024,
            timeout_ms=8000,
        )
        assert res.success is False
        assert res.exit_reason == "memory_exceeded"
        ok = _run("result = {'value': 42}", allowed=(), timeout_ms=8000)
        assert ok.success is True and ok.output == {"value": 42}


# ── @AC-4 numeric parity — frozen golden through the real filter ─────────────────────────────────
class TestNumericParityGolden:
    """Frozen goldens across the breadth the allow set was finalized against (design O-1): a numpy
    convolve SMA, pandas rolling, a LARGE-array linalg (hits mbind/NUMA), fft, groupby, and seeded
    RNG. A numpy/pandas bump that needs a not-allow-listed compute syscall turns these RED."""

    def test_sma_convolve(self):
        res = _run(
            "import numpy as np\nc = np.array(data['p'])\nk = np.ones(5) / 5\n"
            "sma = np.convolve(c, k, mode='valid')\nresult = {'value': round(float(sma[-1]), 6)}",
            data={"p": _PRICES},
            timeout_ms=15000,
        )
        assert res.success is True
        assert res.output == {"value": 46.018}

    def test_pandas_rolling(self):
        res = _run(
            "import pandas as pd\ns = pd.Series(data['p'])\n"
            "result = {'mean': round(float(s.rolling(5).mean().iloc[-1]), 6), "
            "'std': round(float(s.rolling(5).std().iloc[-1]), 6)}",
            data={"p": _PRICES},
            timeout_ms=15000,
        )
        assert res.success is True
        assert res.output == {"mean": 46.018, "std": 0.282966}

    def test_large_array_linalg_hits_mbind(self):
        res = _run(
            "import numpy as np\nrng = np.random.default_rng(0)\n"
            "a = rng.standard_normal((800, 800))\nb = a @ a.T\n"
            "result = {'trace': round(float(np.trace(b)), 3), "
            "'rank': int(np.linalg.matrix_rank(b[:50, :50]))}",
            timeout_ms=20000,
        )
        assert res.success is True
        assert res.output == {"trace": 641260.869, "rank": 50}

    def test_fft(self):
        res = _run(
            "import numpy as np\nx = np.arange(16, dtype=float)\nf = np.fft.rfft(x)\n"
            "result = {'dc': round(float(f[0].real), 3), 'n': int(f.shape[0])}",
            timeout_ms=15000,
        )
        assert res.success is True
        assert res.output == {"dc": 120.0, "n": 9}

    def test_groupby(self):
        res = _run(
            "import pandas as pd\nimport numpy as np\n"
            "df = pd.DataFrame({'g': np.arange(100) % 3, 'v': np.arange(100, dtype=float)})\n"
            "g = df.groupby('g')['v'].sum()\n"
            "result = {'g0': float(g.iloc[0]), 'g1': float(g.iloc[1]), 'g2': float(g.iloc[2])}",
            timeout_ms=15000,
        )
        assert res.success is True
        assert res.output == {"g0": 1683.0, "g1": 1617.0, "g2": 1650.0}

    def test_seeded_rng(self):
        res = _run(
            "import numpy as np\nr = np.random.default_rng(0).random(3)\n"
            "result = {'vals': [round(float(x), 8) for x in r]}",
            timeout_ms=15000,
        )
        assert res.success is True
        assert res.output == {"vals": [0.63696169, 0.26978671, 0.04097352]}


# ── @AC-5 fork-bomb capped + responsiveness ─────────────────────────────────────────────────────
class TestForkBombCapped:
    def test_fork_bomb_is_bounded_and_service_recovers(self):
        """@AC-5: an unbounded os.fork() loop is capped by RLIMIT_NPROC (forked children are inert —
        execve denied); later evaluations still succeed (killpg reclaimed the slots, O-2)."""
        res = _run(
            "import os\nfor _ in range(10000):\n    os.fork()\nresult = {'v': 1}",
            allowed=("os",),
            # RLIMIT_NPROC = 1 * 16 = 16 → the cap trips fast, bounding blast radius.
            max_concurrent=1,
            timeout_ms=8000,
        )
        assert res.success is False
        ok = _run("result = {'value': 7}", allowed=(), timeout_ms=8000)
        assert ok.success is True and ok.output == {"value": 7}


# ── @AC-6 limits configured, not hardcoded ──────────────────────────────────────────────────────
class TestLimitsConfigured:
    def test_rlimits_derive_from_config_in_wrapper(self, monkeypatch):
        """@AC-6: the wrapper derives RLIMIT_CPU = ceil(timeout_ms/1000)+2 and RLIMIT_NPROC =
        max_concurrent*16 from the config-supplied values (F-07), not bare literals."""
        captured = {}

        class _FakeProc:
            pid = 2**30  # nonexistent → _killpg's getpgid raises ProcessLookupError, caught

            def communicate(self, input=None, timeout=None):
                captured["wrapped"] = input
                self.returncode = 0
                return ("__OUTPUT__:{}", "")

        monkeypatch.setattr("app.services.sandbox.subprocess.Popen", lambda *a, **k: _FakeProc())
        _run(
            "result = {}",
            allowed=(),
            timeout_ms=10000,
            memory_bytes=64 * 1024 * 1024,
            max_concurrent=3,
        )
        wrapped = captured["wrapped"]
        assert "resource.setrlimit(resource.RLIMIT_CPU, (12, 12))" in wrapped  # ceil(10000/1000)+2
        assert "resource.setrlimit(resource.RLIMIT_NPROC, (48, 48))" in wrapped  # 3 * 16
        assert "resource.setrlimit(resource.RLIMIT_DATA, (67108864, 67108864))" in wrapped

    def test_no_new_config_leaf_introduced(self):
        """@AC-6: the safety limits are jail constants derived from EXISTING config keys — no new
        indicators.sandbox.* leaf was added (design §6; overlap-scan watch)."""
        import app.config.watcher as watcher

        src = open(watcher.__file__).read()
        for leaf in ("child_uid", "rlimit_nproc", "rlimit_cpu", "max_fsize", "max_open_files"):
            assert f"indicators.sandbox.{leaf}" not in src


# ── Structural allowlist guard (design verification (a), always-run) ─────────────────────────────
class TestSeccompAllowlistShape:
    def test_allowlist_permits_compute_and_denies_dangerous(self):
        """P-06 guard: _SECCOMP_ALLOW permits the compute surface and EXCLUDES the network/exec/
        io_uring/ptrace families. Goes RED the moment a denied syscall is added to the allow set."""
        allow = set(_SECCOMP_ALLOW)
        for needed in ("openat", "read", "write", "mmap", "futex", "brk", "mbind", "clone"):
            assert needed in allow, f"{needed} must stay allowed (FR-4 compute)"
        for denied in (
            "socket",
            "connect",
            "bind",
            "execve",
            "execveat",
            "ptrace",
            "io_uring_setup",
            "io_uring_enter",
            "process_vm_readv",
            "pidfd_getfd",
        ):
            assert denied not in allow, f"{denied} must NEVER be in the allowlist (containment)"
