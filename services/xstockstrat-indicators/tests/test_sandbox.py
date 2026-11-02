"""Unit tests for the sandboxed formula execution engine (app.services.sandbox).

These exercise the real subprocess path — no DB, no gRPC. Run with:
    pytest tests/test_sandbox.py
"""

import subprocess

from app.services import sandbox
from app.services.sandbox import _sandbox_env, execute_formula


class TestSandboxStartupGrace:
    """The wall deadline adds interpreter + numpy/pandas startup (~2s on staging) to the formula
    budget, so a loaded host does not time out a trivial run."""

    def test_deadline_includes_startup_grace(self, monkeypatch):
        seen = {}

        class FakeProc:
            pid = 999_999_999

            def communicate(self, input=None, timeout=None):
                if "first" not in seen:
                    seen["first"] = timeout
                    raise subprocess.TimeoutExpired(cmd="x", timeout=timeout)
                return "", ""

        monkeypatch.setattr(sandbox.subprocess, "Popen", lambda *a, **k: FakeProc())
        monkeypatch.setattr(sandbox, "_killpg", lambda proc: None)

        res = execute_formula(
            source="result = 1", input_data={}, allowed_imports=["math"], timeout_ms=5000
        )

        assert seen["first"] == (5000 + sandbox.SANDBOX_STARTUP_GRACE_MS) / 1000
        assert res.exit_reason == "timeout"
        assert res.error == "Formula execution timed out after 5000ms"


class TestSandboxExecution:
    def test_simple_numeric_result(self):
        """A trivial formula assigning `result` should succeed.

        Regression test for the builtin-filter bug where the wrapper called
        `delattr` after deleting it from `builtins`, raising
        `NameError: name 'delattr' is not defined` for every formula.
        """
        res = execute_formula(
            source="# return a numeric result\nresult = 1",
            input_data={},
            allowed_imports=["math"],
        )
        assert res.success is True
        assert res.exit_reason == "success"
        assert res.output == {"value": 1}
        assert res.error == ""

    def test_dangerous_builtin_removed(self):
        """`open` is not in the safe set and must be unavailable in the sandbox."""
        res = execute_formula(
            source="result = open",
            input_data={},
            allowed_imports=[],
        )
        assert res.success is False
        assert res.exit_reason == "runtime_error"
        assert "NameError" in res.error

    def test_safe_builtin_available(self):
        """A whitelisted builtin (`len`) must still work after filtering."""
        res = execute_formula(
            source="result = len([1, 2, 3])",
            input_data={},
            allowed_imports=[],
        )
        assert res.success is True
        assert res.output == {"value": 3}

    def test_allowed_import_works(self):
        res = execute_formula(
            source="import math\nresult = math.floor(3.7)",
            input_data={},
            allowed_imports=["math"],
        )
        assert res.success is True
        assert res.output == {"value": 3}

    def test_blocked_import(self):
        res = execute_formula(
            source="import socket\nresult = 1",
            input_data={},
            allowed_imports=["math"],
        )
        assert res.success is False
        assert res.exit_reason == "import_blocked"


class TestSandboxEnvIsolation:
    """The sandbox child runs untrusted formula source with a minimal env (C-4): it must never
    inherit the service's secrets, so an escaped formula has nothing sensitive to exfiltrate."""

    def test_sandbox_env_excludes_service_secrets(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgres://user:pw@host/db")
        monkeypatch.setenv("JWT_SECRET", "top-secret")
        monkeypatch.setenv("CONFIG_SECRETS_ENCRYPTION_KEY", "deadbeefdeadbeef")
        monkeypatch.setenv("BROKER_ACCOUNTS_ENCRYPTION_KEY", "cafebabecafebabe")

        env = _sandbox_env()

        for secret in (
            "DATABASE_URL",
            "JWT_SECRET",
            "CONFIG_SECRETS_ENCRYPTION_KEY",
            "BROKER_ACCOUNTS_ENCRYPTION_KEY",
        ):
            assert secret not in env, f"{secret} must not reach the sandbox child"
        # Thread pins preserved (numpy import under the cap); PYTHONPATH kept for resolution.
        assert env["OPENBLAS_NUM_THREADS"] == "1"
        assert "PYTHONPATH" in env


class TestSandboxNumericLibraries:
    """Regression tests: numpy/pandas must import and run under the RLIMIT_AS cap.

    On multi-core hosts the BLAS/OMP backends spawn one thread per core and each
    reserves a large virtual-memory buffer, overflowing the sandbox address-space
    limit with "OpenBLAS error: Memory allocation still failed after 10 retries,
    giving up." The sandbox pins those backends to a single thread to avoid it.
    """

    def test_numpy_convolve_sma(self):
        """np.convolve-based SMA (screenshot repro) must succeed, not OpenBLAS-fail."""
        source = "\n".join(
            [
                "import numpy as np",
                "close = np.array(data['close'], dtype=float)",
                "period = params.get('period', 3)",
                "weights = np.ones(period) / period",
                "sma = np.convolve(close, weights, mode='valid')",
                "result = {'value': sma.tolist()}",
            ]
        )
        res = execute_formula(
            source=source,
            input_data={"close": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]},
            allowed_imports=["numpy"],
            params={"period": 3},
        )
        assert res.success is True, res.error
        assert res.exit_reason == "success"
        assert "OpenBLAS" not in res.error
        assert len(res.output["value"]) == 8

    def test_pandas_rolling(self):
        """pandas rolling/std (Bollinger-band style, screenshot repro) must succeed."""
        source = "\n".join(
            [
                "import pandas as pd",
                "close = pd.Series(data['close'])",
                "mid = close.rolling(3).mean()",
                "std = close.rolling(3).std()",
                "result = {'value': mid.dropna().tolist()}",
            ]
        )
        res = execute_formula(
            source=source,
            input_data={"close": [10, 11, 12, 13, 14, 15]},
            allowed_imports=["numpy", "pandas"],
        )
        assert res.success is True, res.error
        assert res.exit_reason == "success"
        assert "OpenBLAS" not in res.error

    def test_memory_cap_still_enforced(self):
        """Switching RLIMIT_AS->RLIMIT_DATA must not weaken the memory cap: a
        formula that genuinely over-allocates is still rejected as memory_exceeded."""
        source = "\n".join(
            [
                "import numpy as np",
                "a = np.ones((1,), dtype=np.float64)",
                "a.resize((50_000_000,), refcheck=False)",  # ~400 MiB, over the 128 MiB cap
                "result = {'value': float(a.sum())}",
            ]
        )
        res = execute_formula(
            source=source,
            input_data={},
            allowed_imports=["numpy"],
            memory_bytes=128 * 1024 * 1024,
        )
        assert res.success is False
        assert res.exit_reason == "memory_exceeded"


class TestSandboxParams:
    def test_params_available_as_separate_variable(self):
        """`params` is exposed as its own global, resolved from input_params."""
        res = execute_formula(
            source="result = params['period'] * 2",
            input_data={},
            allowed_imports=[],
            params={"period": 7},
        )
        assert res.success is True
        assert res.output == {"value": 14}

    def test_params_not_merged_into_data(self):
        """A parameter key must NOT leak into the `data` namespace (FR-3)."""
        res = execute_formula(
            source="result = 'period' in data",
            input_data={"close": [1, 2, 3]},
            allowed_imports=[],
            params={"period": 7},
        )
        assert res.success is True
        assert res.output == {"value": False}


class TestSandboxNoOutputFails:
    """D-10 (feature 268): a run that never emits a parseable output line fails."""

    def test_ac1_clean_exit_without_output_fails(self):
        """AC-1: a clean exit before the output line is a runtime_error, not success."""
        res = execute_formula(source="raise SystemExit(0)", input_data={}, allowed_imports=[])
        assert res.success is False
        assert "produced no output" in res.error
        assert res.output == {}
        assert res.exit_reason == "runtime_error"

    def test_ac2_unparseable_output_line_fails(self):
        """AC-2: a malformed output line is a runtime_error, not an empty success."""
        res = execute_formula(
            source='print("__OUTPUT__:{")\nraise SystemExit(0)',
            input_data={},
            allowed_imports=[],
        )
        assert res.success is False
        assert "could not be parsed" in res.error
        assert res.exit_reason == "runtime_error"

    def test_ac3_formula_assigning_result_succeeds(self):
        """AC-3: a formula that assigns `result` still succeeds with its output."""
        res = execute_formula(source="result = {'x': 1}", input_data={}, allowed_imports=[])
        assert res.success is True
        assert res.output == {"x": 1}
        assert res.error == ""

    def test_marker_framed_after_unterminated_user_print(self):
        """Marker framing: a user print without a newline must not hide the marker."""
        res = execute_formula(
            source='result = {"x": 1}\nprint("x", end="")',
            input_data={},
            allowed_imports=[],
        )
        assert res.success is True
        assert res.output == {"x": 1}

    def test_os_exit_without_output_fails(self):
        """os._exit(0) reached via numpy traversal skips the output line and fails."""
        res = execute_formula(
            source="import numpy\nnumpy.lib._datasource.os._exit(0)",
            input_data={},
            allowed_imports=["numpy"],
        )
        assert res.success is False
        assert "produced no output" in res.error

    def test_nonzero_exit_with_empty_stderr_has_error_text(self):
        """FR-1: SystemExit(1) leaves stderr empty, yet the error must be non-empty."""
        res = execute_formula(source="raise SystemExit(1)", input_data={}, allowed_imports=[])
        assert res.success is False
        assert res.error != ""
        assert "exited with code 1" in res.error
