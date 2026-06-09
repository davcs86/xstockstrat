"""Unit tests for the sandboxed formula execution engine (app.services.sandbox).

These exercise the real subprocess path — no DB, no gRPC. Run with:
    pytest tests/test_sandbox.py
"""

from app.services.sandbox import execute_formula


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
