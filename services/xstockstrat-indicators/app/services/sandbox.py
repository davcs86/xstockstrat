"""
Sandboxed Python formula execution engine.

Executes user-defined Python formulas in a resource-constrained subprocess.
Timeout and memory cap are sourced from xstockstrat-config:
  - indicators.sandbox.timeout_ms
  - indicators.sandbox.memory_bytes
  - indicators.sandbox.allowed_imports

Security model:
  - Subprocess isolation: formula runs in a fresh Python subprocess
  - Memory cap enforced via resource.setrlimit (RLIMIT_AS) in child process
  - Timeout enforced via subprocess timeout + SIGKILL
  - Import whitelist: only allowed_imports may be imported
  - No filesystem writes, no network access (no socket/urllib/requests)
  - __builtins__ filtered to safe subset
"""
import json
import logging
import os
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass

log = logging.getLogger(__name__)

# Built-in functions allowed in sandbox (conservative subset)
_SAFE_BUILTINS = {
    "abs", "all", "any", "bool", "dict", "dir", "divmod", "enumerate",
    "filter", "float", "format", "frozenset", "getattr", "hasattr", "hash",
    "int", "isinstance", "issubclass", "iter", "len", "list", "map", "max",
    "min", "next", "object", "pow", "print", "range", "repr", "reversed",
    "round", "set", "slice", "sorted", "str", "sum", "tuple", "type", "zip",
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


# Template injected around user formula code
_SANDBOX_WRAPPER = textwrap.dedent("""
import json
import sys
import resource

# Apply memory limit
if {memory_bytes} > 0:
    resource.setrlimit(resource.RLIMIT_AS, ({memory_bytes}, {memory_bytes}))

# Block dangerous builtins
import builtins
_SAFE = set({safe_builtins!r})
for name in list(vars(builtins).keys()):
    if name not in _SAFE and not name.startswith('__'):
        try:
            delattr(builtins, name)
        except AttributeError:
            pass

# Whitelist imports
import sys as _sys
_allowed = set({allowed_imports!r})
import importlib
_real_import = __builtins__.__import__ if hasattr(__builtins__, '__import__') else __import__

def _safe_import(name, *args, **kwargs):
    base = name.split('.')[0]
    if base not in _allowed:
        raise ImportError(f"Import '{{name}}' is not allowed in sandbox")
    return _real_import(name, *args, **kwargs)

import builtins
builtins.__import__ = _safe_import

# Load input data
data = json.loads({input_json!r})

# ── User formula begins ──────────────────────────────────────────────────────
{source}
# ── User formula ends ────────────────────────────────────────────────────────

# Output must be assigned to `result` variable
_output = result if 'result' in dir() else {{}}
print("__OUTPUT__:" + json.dumps(_output if isinstance(_output, dict) else {{"value": _output}}))
""")


def execute_formula(
    source: str,
    input_data: dict,
    allowed_imports: list[str],
    timeout_ms: int = 5000,
    memory_bytes: int = 128 * 1024 * 1024,
) -> SandboxResult:
    """
    Execute formula source in an isolated subprocess with resource limits.
    Returns SandboxResult regardless of outcome.
    """
    import time

    wrapped = _SANDBOX_WRAPPER.format(
        memory_bytes=memory_bytes,
        safe_builtins=sorted(_SAFE_BUILTINS),
        allowed_imports=allowed_imports,
        input_json=json.dumps(input_data),
        source=textwrap.indent(source, "    " * 0),
    )

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(wrapped)
        script_path = f.name

    start = time.monotonic()
    try:
        proc = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            timeout=timeout_ms / 1000,
            env={**os.environ, "PYTHONPATH": os.environ.get("PYTHONPATH", "")},
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        stdout = proc.stdout
        stderr = proc.stderr

        # Parse output
        output = {}
        for line in stdout.splitlines():
            if line.startswith("__OUTPUT__:"):
                try:
                    output = json.loads(line[len("__OUTPUT__:"):])
                except json.JSONDecodeError:
                    pass

        if proc.returncode != 0:
            # Check for import block
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
                error=stderr.strip()[-500:],  # cap error size
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

    except subprocess.TimeoutExpired:
        elapsed_ms = timeout_ms
        return SandboxResult(
            success=False,
            output={},
            stdout="",
            stderr="",
            execution_ms=elapsed_ms,
            memory_used_bytes=0,
            error=f"Formula execution timed out after {timeout_ms}ms",
            exit_reason="timeout",
        )
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass
