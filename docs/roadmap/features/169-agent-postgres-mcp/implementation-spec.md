# Implementation Spec: agent-postgres-mcp

**Status**: `done`
**Created**: 2026-09-02
**Feature**: `docs/roadmap/features/169-agent-postgres-mcp/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/agent-postgres-mcp`

---

## Execution Summary

Implementation proceeds in three logical phases: (1) infrastructure foundation — the Postgres role
runbook, new Python dependencies, supervisord/Dockerfile changes, and the per-call SSE client module
(Steps 1–7); (2) the 9 db_* tool handlers with the FR-11 fail-closed approval gate (Steps 8–9); and
(3) deployment wiring and the six mandatory tool-inventory surfaces (Steps 10–13). Steps 1 and 4 are
non-code-bearing prerequisites for runtime validation; the test steps following each service step satisfy
C-08 pairing. All six inventory surfaces update atomically in Step 12 and are enforced by the CI test in
Step 13.

Consumer surface: the 9 db_* tools appear in the existing Streamable HTTP MCP endpoint
(`xstockstrat-agent`, port 9000) — no new endpoint. Steps 8 and 12 together land the db_* tools on
this named surface. The UI surface is not affected (admin-only JWT path).

## Scenario Coverage

| Scenario | Covered by |
|---|---|
| @AC-1 (postgres-mcp co-process declared in supervisord.conf) | Step 5 |
| @AC-2 (agent process declared in supervisord.conf) | Step 5 |
| @AC-3 (postgres-mcp not bound to 0.0.0.0) | Step 5 |
| @AC-4 (xstockstrat_agent role wired via env var) | Step 1, Step 11 |
| @AC-5 (admin caller gets db_analyze_db_health response) | Step 9 |
| @AC-6 (non-admin caller gets PERMISSION_DENIED) | Step 9 |
| @AC-7 (SELECT via db_execute_sql forwards immediately) | Step 9 |
| @AC-8 (copilot.ts COPILOT_MCP_TOOL_COUNT = 42) | Step 13 |
| @AC-9 (test_tools_endpoint.py 42-name set) | Step 13 |
| @AC-10 (CLAUDE.md budget table updated) | Step 11 |
| @AC-11 (env vars in all 3 deployment files) | Step 11 |
| @AC-12 (UPDATE without confirm returns dry-run) | Step 9 |
| @AC-13 (UPDATE with confirm=True forwards) | Step 9 |

## Step Dependencies

- Step 2 requires Step 1: pyproject.toml adds deps after role doc establishes intended DB access scope
- Step 3 requires Step 2: dep smoke test verifies packages installed by Step 2
- Step 4 requires Step 2: supervisord.conf references postgres-mcp binary installed in Step 2
- Step 5 requires Step 4: structural validation tests the conf file written in Step 4
- Step 6 requires Step 2: postgres_mcp_client.py imports httpx2 and mcp.client.sse added in Step 2
- Step 7 requires Step 6: unit tests exercise the module created in Step 6
- Step 8 requires Steps 2 and 6: handlers import postgres_mcp_client; sqlglot .key verification (executor prerequisite) must run before coding FR-11
- Step 9 requires Step 8: tests assert behavior of handlers added in Step 8
- Step 10 requires Step 1: POSTGRES_MCP_DATABASE_URI encodes credentials for the role created in Step 1
- Step 11 requires Step 10: grep assertions confirm env vars added in Step 10
- Step 12 requires Step 8: inventory surfaces reflect the 9 db_* tools added in Step 8
- Step 13 requires Steps 9, 11, 12: final CI gate covers all code-bearing steps

---

### Step 1 — docs: xstockstrat_agent Postgres role creation runbook

**Status**: `done`
**Service**: `docs/patterns/`
**Files**:
- `docs/patterns/database.md` — modify (add "Application-Level Postgres Roles" section)

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/database.md` exists with connection pool budget, migration tooling, PgBouncer split — no existing "Application-Level Postgres Roles" section (confirmed by inspection)
- Design specifies: "postgres-mcp connects as `xstockstrat_agent` (direct, `:25060`, 1 connection). DBA runbook step (not a migration)" — `design.md` §Connection Pool Budget
- Role is not migration-managed: `golang-migrate` manages schema objects, not login roles; one-time DBA action against managed cluster

**TDD**: N/A (docs step — no executable code)

**Covers**: —

**Instructions**:
1. Open `docs/patterns/database.md`.
2. After the existing connection pool budget section, add a new section `## Application-Level Postgres Roles` containing:
   - Explanation: these roles are created once by the DBA against the managed TimescaleDB cluster and are not tracked by `golang-migrate` (which manages schema objects, not login roles)
   - The following SQL block (run by DBA against the `xstockstrat` database on the managed cluster):

   ```sql
   -- xstockstrat_agent: DML-capable role for the postgres-mcp co-process.
   -- Privileges: CONNECT, USAGE on all schemas, SELECT/INSERT/UPDATE/DELETE on all tables.
   -- Explicitly excluded: CREATE, DROP, ALTER, TRUNCATE (no DDL, no destructive schema ops).
   -- The FR-11 approval gate in the agent enforces confirm=true for UPDATE/DELETE/DROP/TRUNCATE.

   CREATE ROLE xstockstrat_agent WITH LOGIN PASSWORD '<set-at-provision-time>';
   GRANT CONNECT ON DATABASE xstockstrat TO xstockstrat_agent;

   -- Repeat for each application schema (public, and any TimescaleDB data schemas):
   GRANT USAGE ON SCHEMA public TO xstockstrat_agent;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO xstockstrat_agent;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO xstockstrat_agent;

   -- Sequences (required for INSERT into SERIAL/BIGSERIAL columns):
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO xstockstrat_agent;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO xstockstrat_agent;
   ```

   - A note: "Password is provisioned via the DigitalOcean managed-database UI; store it in `POSTGRES_MCP_DATABASE_URI` as a deploy secret (see FR-9 / Step 10 of `169-agent-postgres-mcp` implementation spec)."
   - A note: "Do NOT grant CREATE, DROP, ALTER, TRUNCATE, or superuser to this role."

**Verification**:
```bash
grep -n "xstockstrat_agent" docs/patterns/database.md
# Expected: multiple lines (CREATE ROLE, GRANT, ALTER DEFAULT PRIVILEGES)
grep -n "Application-Level Postgres Roles" docs/patterns/database.md
# Expected: one line with the section heading
```

---

### Step 2 — service: Add runtime dependencies to pyproject.toml + uv.lock

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/pyproject.toml` — modify
- `services/xstockstrat-agent/uv.lock` — modify (regenerated by `uv lock`)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, uv/Dockerfile layering discipline

**Codebase Evidence**:
- `grep "supervisor\|postgres-mcp\|httpx2\|sqlglot" services/xstockstrat-agent/pyproject.toml` → no matches (recon.md §Dependencies — all 4 absent)
- Existing dep pattern: `"mcp>=2.0.0,<3"`, `"httpx>=0.27.0"` — `>=` lower + `<` upper major bounds
- `mcp/client/sse.py` imports `httpx2` exclusively (not `httpx`) — design.md §MCP Client; `httpx2` is currently only a transitive dep, must be explicit
- uv lock rule: root CLAUDE.md §Language Versions — "run `uv lock` inside that service directory and commit the updated `uv.lock` in the same PR"

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Open `services/xstockstrat-agent/pyproject.toml`.
2. In `[project] dependencies`, add these four entries (maintain list order):
   - `"httpx2"` — MCP SDK's actual HTTP client; needed for explicit `httpx2.ConnectError`/`httpx2.ConnectTimeout` imports
   - `"postgres-mcp"` — crystaldba MCP server binary (PyPI: `postgres-mcp`)
   - `"sqlglot>=25.0.0,<26"` — SQL AST parser for FR-11 gate; tight one-major-version cap (`.key` values are version-sensitive)
   - `"supervisor"` — PyPI package providing the `supervisord` process manager
3. Run inside `services/xstockstrat-agent/`:
   ```bash
   uv lock
   ```
4. Commit both `pyproject.toml` and `uv.lock` together.

**Verification**:
```bash
cd services/xstockstrat-agent
uv lock --check
# Expected: exit 0
grep -E "supervisor|postgres-mcp|httpx2|sqlglot" pyproject.toml
# Expected: all 4 entries present
```

---

### Step 3 — test: Dependency installation smoke test

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_dep_smoke.py` — create

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability

**Codebase Evidence**:
- `uv sync --frozen --no-dev` is the Dockerfile install command — packages must be in `[project] dependencies` (not dev-only), which Step 2 enforces
- `postgres-mcp` installs a console-script entry point (`postgres-mcp`); `shutil.which("postgres-mcp")` must resolve after `uv sync`

**TDD**: red-green required

**Covers**: —

**Instructions**:
Create `services/xstockstrat-agent/tests/test_dep_smoke.py`:
```python
"""Smoke tests: all four new runtime dependencies are importable/available."""
import shutil


def test_supervisor_importable():
    import supervisor  # noqa: F401


def test_sqlglot_importable():
    import sqlglot  # noqa: F401


def test_httpx2_importable():
    import httpx2  # noqa: F401


def test_postgres_mcp_binary_on_path():
    assert shutil.which("postgres-mcp") is not None, (
        "postgres-mcp binary not found in PATH — "
        "ensure 'postgres-mcp' is in [project] dependencies and uv sync has run"
    )
```

**Verification**:
```bash
cd services/xstockstrat-agent
uv sync --frozen --no-dev
pytest tests/test_dep_smoke.py -v
# Expected: 4 PASSED
ruff check . && ruff format --check .
pytest --cov=app --cov-fail-under=40
# Expected: coverage ≥ 40%
```

---

### Step 4 — service: supervisord.conf (new) + Dockerfile CMD change

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/supervisord.conf` — create
- `services/xstockstrat-agent/Dockerfile` — modify (add COPY for supervisord.conf; change CMD on line 21)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, OAuth 2.1 edge correctness; Platform Lead — cross-service architecture, new process in container, supervisord vs. one-process-per-container norm

**Codebase Evidence**:
- `Dockerfile:20` = `ENTRYPOINT ["/docker-entrypoint.sh"]`, `Dockerfile:21` = `CMD ["python", "-m", "app.main"]` — recon.md §Entry Point
- Entrypoint does `exec "$@"` — `WAIT_FOR` dep-probe fires before `exec supervisord`; supervisord inherits post-probe env — recon.md §Risks & Traps
- No `environment=` directive on program blocks: supervisor v4 children inherit the full container env — design.md §Process Model (JWT_SECRET, POSTGRES_MCP_DATABASE_URI, POSTGRES_MCP_PORT all flow through)
- `%(ENV_POSTGRES_MCP_PORT)s` is supervisor v4 syntax for env var substitution in `command=`

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Create `services/xstockstrat-agent/supervisord.conf`:
   ```ini
   [supervisord]
   nodaemon=true
   loglevel=info

   [program:app-main]
   command=python -m app.main
   autostart=true
   autorestart=true
   stderr_logfile=/dev/stderr
   stderr_logfile_maxbytes=0
   stdout_logfile=/dev/stdout
   stdout_logfile_maxbytes=0

   [program:postgres-mcp]
   command=postgres-mcp --unrestricted --transport sse --port %(ENV_POSTGRES_MCP_PORT)s
   autostart=true
   autorestart=true
   stderr_logfile=/dev/stderr
   stderr_logfile_maxbytes=0
   stdout_logfile=/dev/stdout
   stdout_logfile_maxbytes=0
   ```
   Notes:
   - `nodaemon=true` keeps supervisord in the foreground as PID 1
   - `%(ENV_POSTGRES_MCP_PORT)s` reads `POSTGRES_MCP_PORT` from the container env at supervisor startup
   - postgres-mcp binds to `127.0.0.1` by default with `--transport sse` — AC-3 satisfied without additional flags
   - No `environment=` directive: full container env inherited by both program blocks

2. Modify `services/xstockstrat-agent/Dockerfile`:
   - After the last existing `COPY` instruction (and before the `CMD` line), add:
     ```
     COPY supervisord.conf /app/supervisord.conf
     ```
   - Change line 21 from:
     ```
     CMD ["python", "-m", "app.main"]
     ```
     to:
     ```
     CMD ["supervisord", "-c", "/app/supervisord.conf"]
     ```

**Verification**:
```bash
grep -n "supervisord" services/xstockstrat-agent/Dockerfile
# Expected: COPY supervisord.conf line + CMD ["supervisord", ...] line
grep -n "nodaemon\|app-main\|postgres-mcp\|autorestart" services/xstockstrat-agent/supervisord.conf
# Expected: all present
grep -n "ENTRYPOINT" services/xstockstrat-agent/Dockerfile
# Expected: still ["/docker-entrypoint.sh"] — must not be changed
```

---

### Step 5 — test: supervisord.conf structural validation

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_supervisord_conf.py` — create

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability; Platform Lead — supervisord PID-1 correctness

**Codebase Evidence**:
- `supervisord.conf` at `services/xstockstrat-agent/supervisord.conf` (created in Step 4)
- Python stdlib `configparser` parses supervisord INI format — no external dep required for this test

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3

**Instructions**:
Create `services/xstockstrat-agent/tests/test_supervisord_conf.py`:
```python
"""
Structural validation of supervisord.conf (AC-1, AC-2, AC-3).
Static-file assertions — no database or runtime required.

AC-1: postgres-mcp co-process is declared in supervisord.conf.
AC-2: app-main (uvicorn agent) is declared in supervisord.conf.
AC-3: postgres-mcp does not bind to 0.0.0.0 (127.0.0.1 is the correct default).

Full runtime verification (both processes actually start) requires docker-compose
integration and is validated at deploy time, not in this unit test.
"""
import configparser
from pathlib import Path

CONF_PATH = Path(__file__).parent.parent / "supervisord.conf"


def _load() -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    cfg.read(CONF_PATH)
    return cfg


def test_conf_file_exists():
    assert CONF_PATH.exists(), f"supervisord.conf not found at {CONF_PATH}"


def test_supervisord_nodaemon():
    cfg = _load()
    assert cfg.get("supervisord", "nodaemon") == "true", (
        "nodaemon must be true — supervisord runs as PID 1 in foreground"
    )


def test_app_main_declared():
    """AC-2: agent (uvicorn) process block exists."""
    assert _load().has_section("program:app-main"), "program:app-main section missing (AC-2)"


def test_app_main_autorestart():
    assert _load().get("program:app-main", "autorestart") == "true"


def test_postgres_mcp_declared():
    """AC-1: postgres-mcp co-process block exists."""
    assert _load().has_section("program:postgres-mcp"), (
        "program:postgres-mcp section missing (AC-1)"
    )


def test_postgres_mcp_autorestart():
    assert _load().get("program:postgres-mcp", "autorestart") == "true"


def test_postgres_mcp_no_external_bind():
    """AC-3: postgres-mcp must NOT explicitly bind to 0.0.0.0."""
    command = _load().get("program:postgres-mcp", "command")
    assert "0.0.0.0" not in command, (
        "postgres-mcp command must not contain 0.0.0.0; "
        "127.0.0.1 is the correct default (AC-3)"
    )


def test_postgres_mcp_unrestricted():
    """FR-2: postgres-mcp must run in --unrestricted mode (write access required)."""
    command = _load().get("program:postgres-mcp", "command")
    assert "--unrestricted" in command, "postgres-mcp must use --unrestricted mode (FR-2)"
```

**Verification**:
```bash
cd services/xstockstrat-agent
pytest tests/test_supervisord_conf.py -v
# Expected: 8 PASSED
ruff check . && ruff format --check .
pytest --cov=app --cov-fail-under=40
```

---

### Step 6 — service: postgres_mcp_client.py — per-call SSE client module (greenfield)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/postgres_mcp_client.py` — create

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, OAuth 2.1 edge correctness; Security — no secret values in tool output

**Codebase Evidence**:
- `mcp.client.sse.sse_client` confirmed available: `mcp>=2.0.0,<3` already in pyproject.toml; SSE path `/sse` is `MCPServer.sse_app` default (`sse_path: str = "/sse"`) — design.md §MCP Client
- `mcp/client/sse.py:8` imports `httpx2` exclusively — catching `httpx.ConnectError` is dead code; correct exceptions are `httpx2.ConnectError`, `httpx2.ConnectTimeout` — design.md §MCP Client
- No existing MCP client code in `services/xstockstrat-agent/app/` — entirely greenfield — recon.md §MCP Client — CRITICAL GAP
- Per-call model (not long-lived session): postgres-mcp supervisor restarts must not strand the agent with a stale connection — design.md §Rejected Alternatives

**TDD**: red-green required

**Covers**: —

**Instructions**:
Create `services/xstockstrat-agent/app/postgres_mcp_client.py`:
```python
"""
Per-call SSE client for the postgres-mcp co-process.

Opens a fresh SSE connection for each db_* tool call. This is intentional:
postgres-mcp restarts (managed by supervisord) would strand a long-lived session.
Each call pays the SSE handshake overhead but is restart-transparent without requiring
an agent restart. (design.md §MCP Client — Per-Call SSE)
"""
import logging
import os
from typing import Any

import httpx2
from mcp import ClientSession
from mcp.client.sse import sse_client

logger = logging.getLogger(__name__)


def _postgres_mcp_url() -> str:
    port = os.environ["POSTGRES_MCP_PORT"]
    return f"http://localhost:{port}/sse"


async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    """
    Call a postgres-mcp tool by name with the given arguments.

    Opens a fresh SSE client per call (design.md §MCP Client).
    Raises RuntimeError on connection failure so db_* handlers surface a clean error.
    """
    url = _postgres_mcp_url()
    try:
        async with sse_client(url) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await session.call_tool(name, arguments)
    except (httpx2.ConnectError, httpx2.ConnectTimeout, OSError) as exc:
        logger.error("postgres-mcp unavailable at %s: %s", url, exc)
        raise RuntimeError(
            f"postgres-mcp co-process is unavailable ({type(exc).__name__}). "
            "Verify that supervisord has started the postgres-mcp program block."
        ) from exc
```

**Verification**:
```bash
cd services/xstockstrat-agent
uv run python -c "from app.postgres_mcp_client import call_tool; print('import ok')"
ruff check app/postgres_mcp_client.py && ruff format --check app/postgres_mcp_client.py
```

---

### Step 7 — test: Unit tests for postgres_mcp_client

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_postgres_mcp_client.py` — create

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability

**Codebase Evidence**:
- Existing pattern: `tests/conftest.py` holds shared fixtures; single-consumer inline fixtures acceptable per C-13
- `sse_client` is an async context manager returning `(read, write)` — mock as `AsyncMock` with `__aenter__`/`__aexit__`

**TDD**: red-green required

**Covers**: —

**Instructions**:
Create `services/xstockstrat-agent/tests/test_postgres_mcp_client.py`:
```python
"""Unit tests for the postgres_mcp_client per-call SSE module."""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx2
import pytest

from app.postgres_mcp_client import _postgres_mcp_url, call_tool


@pytest.fixture(autouse=True)
def port_env(monkeypatch):
    monkeypatch.setenv("POSTGRES_MCP_PORT", "9001")


def test_postgres_mcp_url_uses_env_port(monkeypatch):
    monkeypatch.setenv("POSTGRES_MCP_PORT", "12345")
    url = _postgres_mcp_url()
    assert url == "http://localhost:12345/sse"


@pytest.mark.asyncio
async def test_call_tool_success():
    """Happy path: sse_client connects and returns a tool result."""
    mock_result = MagicMock()
    mock_session = AsyncMock()
    mock_session.call_tool.return_value = mock_result

    with patch("app.postgres_mcp_client.sse_client") as mock_sse, \
         patch("app.postgres_mcp_client.ClientSession") as mock_cs:
        mock_sse.return_value.__aenter__ = AsyncMock(return_value=(AsyncMock(), AsyncMock()))
        mock_sse.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_cs.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cs.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await call_tool("db_list_schemas", {})

    mock_session.initialize.assert_called_once()
    mock_session.call_tool.assert_called_once_with("db_list_schemas", {})
    assert result is mock_result


@pytest.mark.asyncio
async def test_connect_error_raises_runtime_error():
    with patch("app.postgres_mcp_client.sse_client") as mock_sse:
        mock_sse.return_value.__aenter__ = AsyncMock(
            side_effect=httpx2.ConnectError("refused")
        )
        mock_sse.return_value.__aexit__ = AsyncMock(return_value=False)
        with pytest.raises(RuntimeError, match="postgres-mcp co-process is unavailable"):
            await call_tool("db_list_schemas", {})


@pytest.mark.asyncio
async def test_connect_timeout_raises_runtime_error():
    with patch("app.postgres_mcp_client.sse_client") as mock_sse:
        mock_sse.return_value.__aenter__ = AsyncMock(
            side_effect=httpx2.ConnectTimeout("timed out")
        )
        mock_sse.return_value.__aexit__ = AsyncMock(return_value=False)
        with pytest.raises(RuntimeError, match="postgres-mcp co-process is unavailable"):
            await call_tool("db_list_schemas", {})


@pytest.mark.asyncio
async def test_os_error_raises_runtime_error():
    with patch("app.postgres_mcp_client.sse_client") as mock_sse:
        mock_sse.return_value.__aenter__ = AsyncMock(
            side_effect=OSError("no route to host")
        )
        mock_sse.return_value.__aexit__ = AsyncMock(return_value=False)
        with pytest.raises(RuntimeError, match="postgres-mcp co-process is unavailable"):
            await call_tool("db_list_schemas", {})
```

**Verification**:
```bash
cd services/xstockstrat-agent
pytest tests/test_postgres_mcp_client.py -v
# Expected: 5 PASSED
ruff check . && ruff format --check .
pytest --cov=app --cov-fail-under=40
```

---

### Step 8 — service: 9 db_* handlers + _is_destructive helper in tools.py

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (add imports, `_is_destructive` helper, 9 handlers)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, admin scope forwarding pattern; Security — admin-gate enforcement, no secret values in tool output

**Codebase Evidence**:
- `_caller_access_scope(ctx, tool)` at `tools.py:107–116` returns an integer bitmask — recon.md §Tool Registration & Admin Gate
- `_ADMIN = 0x04` in `scopes.py` — recon.md §Tool Registration & Admin Gate
- `trigger_backfill`, `manage_signal_source` use `_caller_access_scope` but delegate admin enforcement to gRPC backend. db_* tools have NO gRPC backend — admin check must be enforced locally in the handler — recon.md §Patterns to REUSE
- `from app import postgres_mcp_client` — module created in Step 6
- **MANDATORY EXECUTOR PREREQUISITE before coding FR-11** (design.md §Open Risks): Run the following and record output in `context.md` before writing `_DESTRUCTIVE_KEYS`:
  ```bash
  cd services/xstockstrat-agent && uv run python -c "
  import sqlglot
  for sql in [
      'TRUNCATE TABLE foo',
      'DROP INDEX foo',
      'UPDATE foo SET x=1',
      'DELETE FROM foo',
  ]:
      print(repr(sql), '->', [e.key for e in sqlglot.parse(sql) if e])
  "
  ```
  Adjust `_DESTRUCTIVE_KEYS` to match the actual `.key` values produced. The assumed values below (`"update"`, `"delete"`, `"drop"`, `"truncatetable"`) must be verified before use.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **Run the sqlglot .key verification** (mandatory — see Codebase Evidence). Record output in `context.md`.

2. Add these imports to the top of `tools.py` (after existing imports):
   ```python
   import re

   import sqlglot
   import sqlglot.errors

   from app import postgres_mcp_client
   ```

3. After the existing private helpers (before the first tool handler), add the `_is_destructive` helper:
   ```python
   # FR-11 approval gate — fail-closed three-tier SQL destructiveness check.
   # EXECUTOR: _DESTRUCTIVE_KEYS values confirmed via sqlglot .key verification (context.md).
   _DESTRUCTIVE_KEYS = frozenset({"update", "delete", "drop", "truncatetable"})

   _COMMENT_RE = re.compile(r"/\*.*?\*/|--[^\n]*", re.DOTALL)
   _DESTRUCTIVE_RE = re.compile(r"\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b", re.IGNORECASE)


   def _is_destructive(sql: str) -> bool:
       """
       Return True if sql contains a destructive statement (UPDATE, DELETE, DROP, TRUNCATE).

       Three-tier fail-closed (design.md §FR-11):
       1. sqlglot AST parse: match .key values against _DESTRUCTIVE_KEYS
       2. Command-node safe-default: unrecognized SQL (VACUUM, REINDEX, etc.) → True
       3. Regex fallback on sqlglot.ParseError (strips comments first)
       """
       try:
           exprs = sqlglot.parse(sql)
           if any(e.key in _DESTRUCTIVE_KEYS for e in exprs if e is not None):
               return True
           if any(e.key == "command" for e in exprs if e is not None):
               logger.warning(
                   "sqlglot Command node in FR-11 gate; safe-defaulting destructive=True"
               )
               return True
           return False
       except MemoryError:
           raise
       except sqlglot.errors.ParseError:
           logger.warning("sqlglot ParseError in FR-11 gate; falling to regex fallback")
           return bool(_DESTRUCTIVE_RE.search(_COMMENT_RE.sub(" ", sql)))
       except Exception as exc:
           logger.warning(
               "sqlglot unexpected error in FR-11 gate (%s); falling to regex fallback",
               type(exc).__name__,
           )
           return bool(_DESTRUCTIVE_RE.search(_COMMENT_RE.sub(" ", sql)))
   ```

4. Append the 9 db_* handler functions after the existing last tool handler. Handler signature follows
   the existing `@server.call_tool()` pattern in `tools.py`. The admin gate enforces locally (unlike
   other tools, there is no gRPC backend to re-enforce it). Pattern for non-`db_execute_sql` handlers:
   ```python
   @server.call_tool()
   async def db_list_schemas(
       name: str, arguments: dict, ctx: Context
   ) -> list[types.TextContent]:
       """List all schemas in the TimescaleDB. Admin-only."""
       tool = "db_list_schemas"
       access_scope = _caller_access_scope(ctx, tool)
       if not (access_scope & 0x04):
           raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")
       result = await postgres_mcp_client.call_tool("list_schemas", {})
       return [types.TextContent(type="text", text=str(result))]
   ```

   For `db_execute_sql` (includes FR-11 gate):
   ```python
   @server.call_tool()
   async def db_execute_sql(
       name: str, arguments: dict, ctx: Context
   ) -> list[types.TextContent]:
       """Execute SQL (DML). Destructive ops require confirm=True. Admin-only."""
       tool = "db_execute_sql"
       access_scope = _caller_access_scope(ctx, tool)
       if not (access_scope & 0x04):
           raise RuntimeError(f"PERMISSION_DENIED: {tool} requires admin scope (bit 0x04)")

       sql: str = arguments.get("sql", "")
       confirm: bool = arguments.get("confirm", False)

       if _is_destructive(sql) and not confirm:
           return [types.TextContent(
               type="text",
               text=(
                   "DRY RUN — destructive SQL detected. "
                   "Re-call with confirm=True to execute:\n\n" + sql
               ),
           )]

       result = await postgres_mcp_client.call_tool("execute_sql", {"sql": sql})
       return [types.TextContent(type="text", text=str(result))]
   ```

   Full list of handlers, upstream tool names, and argument pass-through:

   | Handler | Upstream name | Arguments forwarded |
   |---|---|---|
   | `db_list_schemas` | `list_schemas` | `{}` |
   | `db_list_objects` | `list_objects` | `{"schema": arguments.get("schema")}` |
   | `db_get_object_details` | `get_object_details` | `{"schema": arguments.get("schema"), "name": arguments.get("name")}` |
   | `db_execute_sql` | `execute_sql` | `{"sql": sql}` (after FR-11 gate) |
   | `db_explain_query` | `explain_query` | `{"sql": arguments.get("sql")}` |
   | `db_get_top_queries` | `get_top_queries` | `{"limit": arguments.get("limit", 10)}` |
   | `db_analyze_workload_indexes` | `analyze_workload_indexes` | `{}` |
   | `db_analyze_query_indexes` | `analyze_query_indexes` | `{"sql": arguments.get("sql")}` |
   | `db_analyze_db_health` | `analyze_db_health` | `{"health_type": arguments.get("health_type", "all")}` |

**Verification**:
```bash
cd services/xstockstrat-agent
uv run python -c "
from app.tools import _is_destructive
assert _is_destructive('SELECT 1') is False
assert _is_destructive('UPDATE foo SET x=1') is True
assert _is_destructive('DELETE FROM foo') is True
assert _is_destructive('TRUNCATE TABLE foo') is True
assert _is_destructive('DROP INDEX foo') is True
print('all _is_destructive assertions passed')
"
ruff check app/tools.py && ruff format --check app/tools.py
```

---

### Step 9 — test: Unit tests for db_* handlers (admin gate + FR-11 gate)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_db_tools.py` — create

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability; Security — admin-gate enforcement

**Codebase Evidence**:
- Existing pattern for mocking `_caller_access_scope`: `patch("app.tools._caller_access_scope", return_value=<bitmask>)` — from `test_tools.py`
- `_ADMIN = 0x04` in `scopes.py`; admin bitmask value 7 (`0x01 | 0x02 | 0x04`); non-admin 3 (`0x01 | 0x02`)

**TDD**: red-green required

**Covers**: AC-5, AC-6, AC-7, AC-12, AC-13

**Instructions**:
Create `services/xstockstrat-agent/tests/test_db_tools.py`:
```python
"""
Unit tests for db_* handlers and the _is_destructive FR-11 gate.

AC-5: admin caller gets a response from db_analyze_db_health
AC-6: non-admin caller gets PERMISSION_DENIED
AC-7: SELECT via db_execute_sql forwards immediately (no dry-run)
AC-12: UPDATE without confirm=True returns dry-run, NOT forwarded
AC-13: UPDATE with confirm=True is forwarded to postgres-mcp
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.tools import _is_destructive

ADMIN_SCOPE = 0x07    # read | write | admin
NON_ADMIN_SCOPE = 0x03  # read | write, no admin bit


# ── _is_destructive ───────────────────────────────────────────────────────────

class TestIsDestructive:
    def test_select_not_destructive(self):
        assert _is_destructive("SELECT * FROM foo") is False

    def test_insert_not_destructive(self):
        assert _is_destructive("INSERT INTO foo VALUES (1)") is False

    def test_update_is_destructive(self):
        assert _is_destructive("UPDATE foo SET x=1 WHERE id=1") is True

    def test_delete_is_destructive(self):
        assert _is_destructive("DELETE FROM foo WHERE id=1") is True

    def test_drop_is_destructive(self):
        assert _is_destructive("DROP INDEX foo_idx") is True

    def test_truncate_is_destructive(self):
        """TRUNCATE must return True regardless of sqlglot branch (design.md §Open Risks)."""
        assert _is_destructive("TRUNCATE TABLE foo") is True

    def test_commented_update_not_destructive(self):
        """UPDATE only in SQL comment must not be flagged."""
        assert _is_destructive("SELECT 1 -- UPDATE foo SET x=1") is False

    def test_multistatement_with_delete_is_destructive(self):
        assert _is_destructive("SELECT 1; DELETE FROM foo;") is True


# ── Admin gate ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_db_analyze_db_health_admin_succeeds():
    """AC-5: admin caller receives a non-error tool response."""
    mock_result = MagicMock()
    ctx = MagicMock()
    with patch("app.tools._caller_access_scope", return_value=ADMIN_SCOPE), \
         patch("app.tools.postgres_mcp_client.call_tool", new=AsyncMock(return_value=mock_result)):
        from app.tools import db_analyze_db_health
        result = await db_analyze_db_health(
            "db_analyze_db_health", {"health_type": "all"}, ctx
        )
    assert result is not None


@pytest.mark.asyncio
async def test_db_analyze_db_health_non_admin_denied():
    """AC-6: non-admin caller receives PERMISSION_DENIED RuntimeError."""
    ctx = MagicMock()
    with patch("app.tools._caller_access_scope", return_value=NON_ADMIN_SCOPE):
        from app.tools import db_analyze_db_health
        with pytest.raises(RuntimeError, match="PERMISSION_DENIED"):
            await db_analyze_db_health(
                "db_analyze_db_health", {"health_type": "all"}, ctx
            )


# ── FR-11 gate ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_db_execute_sql_select_forwards_immediately():
    """AC-7: SELECT bypasses FR-11 gate and forwards to postgres-mcp."""
    mock_result = MagicMock()
    ctx = MagicMock()
    with patch("app.tools._caller_access_scope", return_value=ADMIN_SCOPE), \
         patch("app.tools.postgres_mcp_client.call_tool",
               new=AsyncMock(return_value=mock_result)) as mock_call:
        from app.tools import db_execute_sql
        result = await db_execute_sql(
            "db_execute_sql", {"sql": "SELECT 1", "confirm": False}, ctx
        )
    mock_call.assert_called_once_with("execute_sql", {"sql": "SELECT 1"})
    result_text = " ".join(c.text for c in result if hasattr(c, "text"))
    assert "DRY RUN" not in result_text


@pytest.mark.asyncio
async def test_db_execute_sql_update_without_confirm_dry_run():
    """AC-12: UPDATE without confirm=True returns dry-run message; postgres-mcp NOT called."""
    ctx = MagicMock()
    with patch("app.tools._caller_access_scope", return_value=ADMIN_SCOPE), \
         patch("app.tools.postgres_mcp_client.call_tool",
               new=AsyncMock()) as mock_call:
        from app.tools import db_execute_sql
        result = await db_execute_sql(
            "db_execute_sql", {"sql": "UPDATE foo SET x=1", "confirm": False}, ctx
        )
    mock_call.assert_not_called()
    result_text = " ".join(c.text for c in result if hasattr(c, "text"))
    assert "DRY RUN" in result_text


@pytest.mark.asyncio
async def test_db_execute_sql_update_with_confirm_forwards():
    """AC-13: UPDATE with confirm=True is forwarded to postgres-mcp."""
    mock_result = MagicMock()
    ctx = MagicMock()
    with patch("app.tools._caller_access_scope", return_value=ADMIN_SCOPE), \
         patch("app.tools.postgres_mcp_client.call_tool",
               new=AsyncMock(return_value=mock_result)) as mock_call:
        from app.tools import db_execute_sql
        result = await db_execute_sql(
            "db_execute_sql", {"sql": "UPDATE foo SET x=1", "confirm": True}, ctx
        )
    mock_call.assert_called_once_with("execute_sql", {"sql": "UPDATE foo SET x=1"})
```

**Verification**:
```bash
cd services/xstockstrat-agent
pytest tests/test_db_tools.py -v
# Expected: all tests PASSED (AC-5, AC-6, AC-7, AC-12, AC-13 covered)
ruff check . && ruff format --check .
pytest --cov=app --cov-fail-under=40
```

---

### Step 10 — service: Env var injection in deployment files + connection budget update

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `docker-compose.yml` — modify (add `POSTGRES_MCP_DATABASE_URI` and `POSTGRES_MCP_PORT` to xstockstrat-agent env block)
- `.do/app.dev.yaml` — modify (add same 2 env vars to xstockstrat-agent component envs — see NOTE on 084 overlap)
- `.do/app.yaml` — modify (add same 2 env vars to xstockstrat-agent component envs)
- `CLAUDE.md` — modify (connection budget table: add postgres-mcp row; direct total 8 → 9)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability; DBA — connection-pool budget impact

**Codebase Evidence**:
- `docker-compose.yml:519–555`: xstockstrat-agent env block present; both vars absent — recon.md §Environment Variables
- `.do/app.dev.yaml:254–283`: both vars absent — recon.md §Environment Variables
- `.do/app.yaml:252+`: both vars absent — recon.md §Environment Variables
- Root `CLAUDE.md`: "Direct backend total ... **8**" — recon.md §Connection Pool Budget
- **Feature 084 overlap (MANDATORY pre-check)**: `084-droplet-compose-deploy` overlaps these same three files. Check status before executing this step:
  ```bash
  cat docs/roadmap/features/084-droplet-compose-deploy/status.md
  ```
  If 084 status is `launched`, consult `docs/roadmap/features/084-droplet-compose-deploy/context.md` for the correct secrets-injection mechanism before editing `.do/app.dev.yaml`.
- `POSTGRES_MCP_DATABASE_URI` is a credential env var (not a config-service key) — legitimate deviation from C-10/PLAT-4 because postgres-mcp reads it at process startup from env, not via GetSecret RPC — context.md 2026-09-02T00:01Z

**TDD**: red-green required

**Covers**: —

**Instructions**:

**Run the 084 status pre-check before any edits:**
```bash
cat docs/roadmap/features/084-droplet-compose-deploy/status.md
```

**Assuming 084 is not yet `launched`:**

1. In `docker-compose.yml`, in the `xstockstrat-agent` service `environment:` block, add:
   ```yaml
   - POSTGRES_MCP_DATABASE_URI=postgresql://xstockstrat_agent:${AGENT_DB_PASSWORD}@${DB_HOST}:25060/xstockstrat?sslmode=require
   - POSTGRES_MCP_PORT=9001
   ```
   (Use env var placeholders for credentials — actual values are set in `.env` or DO secrets, not committed.)

2. In `.do/app.dev.yaml`, in the `xstockstrat-agent` component `envs:` list, add:
   ```yaml
   - key: POSTGRES_MCP_DATABASE_URI
     scope: RUN_TIME
     type: SECRET
     value: ""
   - key: POSTGRES_MCP_PORT
     scope: RUN_TIME
     value: "9001"
   ```

3. In `.do/app.yaml`, in the `xstockstrat-agent` component `envs:` list, add the same two entries.

4. In root `CLAUDE.md`, in the connection budget table:
   - Add a new row immediately before `| **Direct backend total** |`:
     ```
     | postgres-mcp (xstockstrat_agent role) | Python | direct `:25060` | 1 | postgres-mcp co-process in agent container; DML-capable, no DDL |
     ```
   - Update the direct-backend total from `**8**` to `**9**` in the Pool max column.

**Verification**:
```bash
grep -n "POSTGRES_MCP_DATABASE_URI\|POSTGRES_MCP_PORT" \
  docker-compose.yml .do/app.dev.yaml .do/app.yaml
# Expected: at least 2 matches per file (6 lines total across 3 files)
grep -n "postgres-mcp.*xstockstrat_agent\|xstockstrat_agent.*direct" CLAUDE.md
# Expected: the new budget table row
```

---

### Step 11 — test: Static-file assertions for env vars and connection budget

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_deployment_env_vars.py` — create

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability; DBA — connection-pool budget impact

**Codebase Evidence**:
- Same static-file assertion pattern as `test_tools_endpoint.py` (grep-style checks in pytest)
- AC-10 and AC-11 are "verified by PR diff review" (per context.md 2026-09-02T00:01Z); this test suite provides CI enforcement

**TDD**: red-green required

**Covers**: AC-4, AC-10, AC-11

**Instructions**:
Create `services/xstockstrat-agent/tests/test_deployment_env_vars.py`:
```python
"""
Static-file CI assertions for deployment env vars and connection budget (AC-4, AC-10, AC-11).
Primary verification is PR diff review; this suite enforces in CI.

AC-4: POSTGRES_MCP_DATABASE_URI present (wires xstockstrat_agent credentials to postgres-mcp)
AC-10: Root CLAUDE.md connection budget updated for postgres-mcp's 1 direct connection
AC-11: Both vars present in all 3 deployment files
"""
from pathlib import Path

# Depth from test file to repo root:
# tests/ -> xstockstrat-agent/ -> services/ -> (repo root)
REPO_ROOT = Path(__file__).parent.parent.parent.parent


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_docker_compose_has_database_uri():
    """AC-11: docker-compose.yml has POSTGRES_MCP_DATABASE_URI."""
    assert "POSTGRES_MCP_DATABASE_URI" in _read("docker-compose.yml")


def test_docker_compose_has_port():
    """AC-11: docker-compose.yml has POSTGRES_MCP_PORT."""
    assert "POSTGRES_MCP_PORT" in _read("docker-compose.yml")


def test_app_dev_yaml_has_database_uri():
    """AC-11: .do/app.dev.yaml has POSTGRES_MCP_DATABASE_URI."""
    assert "POSTGRES_MCP_DATABASE_URI" in _read(".do/app.dev.yaml")


def test_app_dev_yaml_has_port():
    """AC-11: .do/app.dev.yaml has POSTGRES_MCP_PORT."""
    assert "POSTGRES_MCP_PORT" in _read(".do/app.dev.yaml")


def test_app_yaml_has_database_uri():
    """AC-11: .do/app.yaml has POSTGRES_MCP_DATABASE_URI."""
    assert "POSTGRES_MCP_DATABASE_URI" in _read(".do/app.yaml")


def test_app_yaml_has_port():
    """AC-11: .do/app.yaml has POSTGRES_MCP_PORT."""
    assert "POSTGRES_MCP_PORT" in _read(".do/app.yaml")


def test_claude_md_has_agent_role_in_budget():
    """AC-10: Root CLAUDE.md connection budget table mentions xstockstrat_agent role."""
    content = _read("CLAUDE.md")
    assert "xstockstrat_agent" in content, (
        "Root CLAUDE.md must contain xstockstrat_agent in the connection budget table (AC-10)"
    )


def test_claude_md_direct_total_is_nine():
    """AC-10: Root CLAUDE.md direct-backend total is updated to 9."""
    content = _read("CLAUDE.md")
    # The direct backend total row must show 9, not 8
    assert "**9**" in content, (
        "Root CLAUDE.md direct-backend total must be **9** after adding postgres-mcp (AC-10)"
    )
```

**Verification**:
```bash
cd services/xstockstrat-agent
pytest tests/test_deployment_env_vars.py -v
# Expected: 8 PASSED
ruff check . && ruff format --check .
pytest --cov=app --cov-fail-under=40
```

---

### Step 12 — service: 6 tool-inventory surfaces (atomic update)

**Status**: `done`
**Service**: `xstockstrat-agent` (primary); `xstockstrat-ui` (copilot.ts surface)
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (module docstring: "Thirty-three" → "Forty-two"; add 9 names to the tool list)
- `services/xstockstrat-agent/CLAUDE.md` — modify ("thirty-three tools" → "forty-two tools"; add 9 rows to tool reference table)
- `docs/runbooks/mcp-tools.md` — modify (header count "thirty-three" → "forty-two"; add 9 db_* entries in new "Database Tools" section)
- `services/xstockstrat-agent/tests/test_tools_endpoint.py` — modify (add 9 db_* names to exact-name set; total 33 → 42)
- `services/xstockstrat-ui/src/lib/copilot.ts` — modify (`COPILOT_MCP_TOOL_COUNT = 32` → `42`; absorbs pre-existing 32→33 stale drift + adds 9)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, mcp-tools.md parity, all six inventory surfaces

**Codebase Evidence**:
- `tools.py:1` docstring: "Thirty-three tools" — recon.md §Tool Inventory Surfaces
- `services/xstockstrat-agent/CLAUDE.md:43`: "thirty-three tools" + 33-row table — recon.md §Tool Inventory Surfaces
- `docs/runbooks/mcp-tools.md:3`: "Complete reference for the thirty-three tools" — recon.md §Tool Inventory Surfaces
- `tests/test_tools_endpoint.py:23–57`: 33-name literal set — recon.md §Tool Inventory Surfaces
- `services/xstockstrat-ui/src/lib/copilot.ts:14`: `COPILOT_MCP_TOOL_COUNT = 32` — **pre-existing stale by 1**; this step corrects to 42 (absorbing the 32→33 drift) — recon.md §Tool Inventory Surfaces
- All 6 surfaces must update in the same PR — design.md §6 Inventory Surfaces

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. **`services/xstockstrat-agent/app/tools.py`** — module docstring:
   - Change "Thirty-three tools" to "Forty-two tools"
   - Add the 9 new tool names to the enumerated list: `db_list_schemas`, `db_list_objects`, `db_get_object_details`, `db_execute_sql`, `db_explain_query`, `db_get_top_queries`, `db_analyze_workload_indexes`, `db_analyze_query_indexes`, `db_analyze_db_health`

2. **`services/xstockstrat-agent/CLAUDE.md`**:
   - Change "thirty-three tools" to "forty-two tools"
   - Add 9 rows to the tool table with tool name, brief description, and "(Admin-only)" annotation

3. **`docs/runbooks/mcp-tools.md`**:
   - Change line 3 "Complete reference for the thirty-three tools" to "Complete reference for the forty-two tools"
   - Add a new `## Database Tools (Admin-only)` section with 9 entries; each entry must include:
     - Tool name
     - Description
     - Input parameters (argument schema)
     - Return shape: plain text from postgres-mcp (not JSON)
     - "Admin-only: requires `x-access-scope` bit `0x04`"
     - For `db_execute_sql`: document `confirm: bool (default false)`; note dry-run behavior when destructive SQL is detected and `confirm=false`

4. **`services/xstockstrat-agent/tests/test_tools_endpoint.py`**:
   - Find the exact-name set literal (lines 23–57; currently 33 names)
   - Add the 9 db_* names:
     `"db_list_schemas"`, `"db_list_objects"`, `"db_get_object_details"`, `"db_execute_sql"`,
     `"db_explain_query"`, `"db_get_top_queries"`, `"db_analyze_workload_indexes"`,
     `"db_analyze_query_indexes"`, `"db_analyze_db_health"`
   - The set must now contain exactly 42 names

5. **`services/xstockstrat-ui/src/lib/copilot.ts`**:
   - Change `COPILOT_MCP_TOOL_COUNT = 32` → `COPILOT_MCP_TOOL_COUNT = 42`

**Verification**:
```bash
# All 6 surfaces reference the new count:
grep -rn "Forty-two\|forty-two" \
  services/xstockstrat-agent/app/tools.py \
  services/xstockstrat-agent/CLAUDE.md \
  docs/runbooks/mcp-tools.md
# Expected: at least one match in each of the 3 files

grep -n "COPILOT_MCP_TOOL_COUNT" services/xstockstrat-ui/src/lib/copilot.ts
# Expected: COPILOT_MCP_TOOL_COUNT = 42

# 9 db_* names in the endpoint test:
grep -c "db_list_schemas\|db_list_objects\|db_get_object_details\|db_execute_sql\|db_explain_query\|db_get_top_queries\|db_analyze_workload_indexes\|db_analyze_query_indexes\|db_analyze_db_health" \
  services/xstockstrat-agent/tests/test_tools_endpoint.py
# Expected: 9
```

---

### Step 13 — test: Full CI gate — coverage, tool-name set, lint

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- (no new files — verification only)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability

**Codebase Evidence**:
- `test_tools_endpoint.py:23–57`: after Step 12 the set has 42 names; CI asserts this at runtime against the live MCP registration — recon.md §Tests
- Coverage threshold for xstockstrat-agent (Python): 40% — spec-template.md §Coverage thresholds
- `COPILOT_MCP_TOOL_COUNT = 42` in copilot.ts verified by grep (AC-8); `test_tools_endpoint.py` 42-name set verified by CI (AC-9)

**TDD**: red-green required

**Covers**: AC-8, AC-9

**Instructions**:
1. Run full test suite with coverage:
   ```bash
   cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40 -v
   ```
2. Run lint:
   ```bash
   cd services/xstockstrat-agent && ruff check . && ruff format --check .
   ```
3. Confirm AC-8 (copilot.ts):
   ```bash
   grep "COPILOT_MCP_TOOL_COUNT" services/xstockstrat-ui/src/lib/copilot.ts
   # Expected: COPILOT_MCP_TOOL_COUNT = 42
   ```
4. Confirm AC-9 (test_tools_endpoint.py exact-name set): `pytest tests/test_tools_endpoint.py -v` passes (the 42-name set assertion succeeds against the registered tool list).

**Verification**:
```bash
cd services/xstockstrat-agent
pytest --cov=app --cov-fail-under=40
# Expected: exit 0, coverage ≥ 40%, all tests PASSED

ruff check . && ruff format --check .
# Expected: exit 0

grep "COPILOT_MCP_TOOL_COUNT = 42" ../xstockstrat-ui/src/lib/copilot.ts
# Expected: match (AC-8)

pytest tests/test_tools_endpoint.py -v
# Expected: PASSED — 42-name set assertion succeeds (AC-9)
# Note: test_tools_endpoint.py requires a running agent process; CI handles this.
# In local dev without docker-compose, the static grep above satisfies AC-9 pre-flight.
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
