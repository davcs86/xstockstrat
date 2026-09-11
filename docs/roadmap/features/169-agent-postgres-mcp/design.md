# Design: agent-postgres-mcp

**Created**: 2026-09-02
**Rounds**: 3 (quick; user-extended to 3; termination: approved)
**Approved by**: user @ 2026-09-02
**Grounded in**: recon.md

---

## Chosen Approach

### Process Model — supervisord as PID 1

Change `CMD ["python", "-m", "app.main"]` → `CMD ["supervisord", "-c", "/app/supervisord.conf"]`
(recon.md §Entry Point — `services/xstockstrat-agent/Dockerfile:21`). `ENTRYPOINT
["/docker-entrypoint.sh"]` is preserved (recon.md §Entry Point — `Dockerfile:20`); the entrypoint
does `exec "$@"`, so the `WAIT_FOR` dep-probe fires before supervisord inherits the post-probe env.

`supervisord.conf` (new file at `/app/supervisord.conf`) declares two `[program:*]` blocks:
- `[program:app-main]` — `command=python -m app.main`; the uvicorn process, `autorestart=true`
- `[program:postgres-mcp]` — `command=postgres-mcp --unrestricted ...`; bound to
  `127.0.0.1:%(ENV_POSTGRES_MCP_PORT)s`; `autorestart=true`

No `environment=` directive on either block — supervisor v4 child processes inherit the full
container env, so `JWT_SECRET`, `POSTGRES_MCP_DATABASE_URI`, `POSTGRES_MCP_PORT` and all existing
vars flow through without explicit listing (recon.md §Risks & Traps — "Supervisord startup ordering").

### New Dependencies

`pyproject.toml` gains four runtime deps; `uv lock` committed in the same PR:
- `supervisor` — the `supervisord` PID-1 process manager
- `postgres-mcp` — the crystaldba MCP server binary
- `httpx2` — direct dep (currently a transitive dep of `mcp`); needed for explicit import of
  `httpx2.ConnectError`/`httpx2.ConnectTimeout` in db_* tool handlers
- `sqlglot>=25.0.0,<26` — SQL AST parser for the FR-11 approval gate (tight one-major-version cap)

### MCP Client — Per-Call SSE

Each `db_*` tool handler opens a fresh SSE client per call:

```python
from mcp.client.sse import sse_client
from mcp import ClientSession
import httpx2

async with sse_client(f"http://localhost:{POSTGRES_MCP_PORT}/sse") as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        result = await session.call_tool(name, args)
```

SSE path `/sse` is the `MCPServer.sse_app` default, confirmed from SDK source
(`mcp.server.mcpserver.MCPServer.sse_app:3`, `sse_path: str = "/sse"`).
postgres-mcp binds to `127.0.0.1` by default — AC-3 (no external access) satisfied without
additional config.

Connection errors caught as `except (httpx2.ConnectError, httpx2.ConnectTimeout, OSError)` —
mcp SDK imports `httpx2` exclusively (`mcp/client/sse.py:8`); `httpx.ConnectError` is dead code
here (recon.md §Risks & Traps).

### Admin Gate

`_caller_access_scope(ctx, tool)` called before any per-call SSE client open — exact same pattern
as `trigger_backfill` and `manage_signal_source` (recon.md §Patterns to REUSE —
`services/xstockstrat-agent/app/tools.py:107-116`). Non-admin (bit `0x04` not set) →
`PERMISSION_DENIED` before sqlglot parse, before SSE connection attempt.

### FR-11 Approval Gate — Fail-Closed Three-Tier

The private helper `_is_destructive(sql: str) -> bool` is called by `db_execute_sql` after the
admin gate, before the SSE client:

```python
_DESTRUCTIVE_KEYS = frozenset({"update", "delete", "drop", "truncatetable"})
# EXECUTOR MUST VERIFY: run verification step before coding (see Open Risks)

_COMMENT_RE = re.compile(r"/\*.*?\*/|--[^\n]*", re.DOTALL)
_DESTRUCTIVE_RE = re.compile(r"\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b", re.IGNORECASE)

def _is_destructive(sql: str) -> bool:
    try:
        exprs = sqlglot.parse(sql)           # plural: covers multi-statement payloads
        if any(e.key in _DESTRUCTIVE_KEYS for e in exprs):
            return True
        if any(e.key == "command" for e in exprs):
            # Fail-closed: unrecognized SQL (VACUUM, REINDEX, extension DDL) → require confirm
            # UX trade-off accepted: legitimate non-destructive admin ops also require confirm
            logger.warning("sqlglot Command node detected; safe-defaulting destructive=True")
            return True
        return False
    except MemoryError:
        raise                                # resource failure — never swallow
    except sqlglot.errors.ParseError:
        logger.warning("sqlglot ParseError; falling to regex gate")
        return bool(_DESTRUCTIVE_RE.search(_COMMENT_RE.sub(" ", sql)))
    except Exception as exc:
        logger.warning("sqlglot unexpected error (%s); falling to regex gate", type(exc).__name__)
        return bool(_DESTRUCTIVE_RE.search(_COMMENT_RE.sub(" ", sql)))
```

`db_execute_sql` gains a `confirm: bool = False` parameter. If `_is_destructive(sql)` and not
`confirm`, returns `TextContent` dry-run message without forwarding. `confirm=True` → forwards.
SELECT and INSERT bypass `_is_destructive` — they never block.

**Mandatory executor prerequisite** (see Open Risks): before coding FR-11, install sqlglot via
`uv add 'sqlglot>=25.0.0,<26'`, then verify `.key` values:
```python
import sqlglot
print([e.key for e in sqlglot.parse("TRUNCATE TABLE foo")])   # expect "truncatetable" or "command"
print([e.key for e in sqlglot.parse("DROP INDEX foo")])        # expect "drop" or "dropindex"
print([e.key for e in sqlglot.parse("UPDATE foo SET x=1")])   # expect "update"
```
Adjust `_DESTRUCTIVE_KEYS` to match actual output. Record in `context.md`.

### Tool Registration — 9 db_* Tools

9 new handlers in `app/tools.py`, prefixed `db_` to prevent collision (recon.md §Tool Registration):
`db_list_schemas`, `db_list_objects`, `db_get_object_details`, `db_execute_sql`,
`db_explain_query`, `db_get_top_queries`, `db_analyze_workload_indexes`,
`db_analyze_query_indexes`, `db_analyze_db_health`.

Each handler: admin gate → (for `db_execute_sql`: approval gate) → per-call SSE → return result.

### 6 Inventory Surfaces (all updated atomically, same PR)

- `app/tools.py` docstring: "Forty-two tools" (33→42)
- `services/xstockstrat-agent/CLAUDE.md` tool table: +9 rows
- `docs/runbooks/mcp-tools.md`: header "forty-two tools"; +9 entries with params, return shape, "Admin-only"
- `services/xstockstrat-agent/tests/test_tools_endpoint.py`: add 9 `db_*` names to exact-name set
- `services/xstockstrat-ui/src/lib/copilot.ts`: `COPILOT_MCP_TOOL_COUNT = 42` (absorbs pre-existing stale 32→33 drift)

### Environment Variables

Two new env vars (not config-service keys — credential deviation documented per C-10/PLAT-4):
- `POSTGRES_MCP_DATABASE_URI` — DB URI for xstockstrat_agent role; present in
  `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`
- `POSTGRES_MCP_PORT` — SSE bind port for postgres-mcp co-process; present in same files

### Connection Pool Budget

postgres-mcp connects as `xstockstrat_agent` (direct, `:25060`, 1 connection). Root CLAUDE.md
connection budget table: direct-backend total 8 → 9.

**Consumer surface**: the 9 `db_*` tools appear in the existing Streamable HTTP MCP endpoint
(`xstockstrat-agent`, port 9000) — no new endpoint, no UI surface (admin-only via JWT).

---

## Rejected Alternatives

- **Separate `postgres-mcp` service** (dedicated container) — rejected because it adds a new service
  to the registry, a new network hop, and requires the MCP client to reach across containers; the
  product spec explicitly mandated co-process within the agent container.
- **Long-lived SSE session** (connect once at startup, reuse) — rejected because a mid-life postgres-mcp
  restart (which supervisord triggers on crash) would leave the agent holding a stale SSE connection
  with no recovery path without restarting the agent itself; per-call model handles restarts transparently.
- **`systemd` as PID 1** — rejected; not available in the Alpine/slim Docker base image; supervisord
  is a pure-Python, pip-installable alternative already in the Python ecosystem (recon.md §Risks & Traps).
- **Exposing postgres-mcp on a non-localhost port** — rejected; AC-3 requires postgres-mcp not be
  reachable from outside the container; `127.0.0.1` bind is the correct enforcement.
- **httpx for SSE client transport** — rejected; mcp SDK uses `httpx2` exclusively
  (`mcp/client/sse.py:8`); catching `httpx.ConnectError` is dead code.
- **Regex-only FR-11 gate (no sqlglot)** — rejected by user; user explicitly kept sqlglot as primary
  AST gate with regex as fallback.
- **Fail-open Command-node branch** (regex fallback only, no safe-default) — rejected; violates
  fails.md `2026-08-06` ("validate_* functions must be fail-closed from the start"); VACUUM/REINDEX
  UX cost accepted in exchange for correctness.
- **sqlglot tokenizer as fallback** (instead of regex) — rejected for this PR; unverified API surface
  (same C-01 risk as the primary AST gate); regex is simpler and verifiable.

---

## Open Risks

- [ ] **sqlglot `.key` value verification** — `.key` values for UPDATE/DELETE/DROP/TRUNCATE assumed from
  documentation (sqlglot absent from venv at design time). Executor must run the three-line verification
  check and adjust `_DESTRUCTIVE_KEYS` before coding FR-11. To be addressed at FR-11 implementation step.
- [ ] **084-droplet-compose-deploy overlap** — `docker-compose.yml`, `.do/app.dev.yaml`, `.do/app.yaml`
  are shared with feature 084. If 084 merges first, FR-9 env-var wiring switches from `.do/app.dev.yaml`
  to 084's secrets-injection mechanism. Executor must check 084 merge status before executing FR-9
  (context.md open thread, 2026-09-02).
- [ ] **Unit test: TRUNCATE → True regardless of sqlglot branch** — `_is_destructive("TRUNCATE TABLE foo")`
  must return `True` whether via frozenset match or Command-node safe-default. Enforces correctness
  across sqlglot version upgrades. To be addressed at FR-11 test step.

---

## Constitution Rules Touched

- `C-01` (grounded in codebase evidence) — honored by: SSE path `/sse` verified from SDK source;
  `httpx2` import verified from `mcp/client/sse.py:8`; sqlglot `.key` values flagged as unverified
  (executor prerequisite mandated).
- `C-02` (context.md read before writing) — honored by: context.md read at boot; all prior decisions
  carried forward; credential deviation documented.
- `C-10 / PLAT-4` (secrets via config service) — honored by: `POSTGRES_MCP_DATABASE_URI` deviation
  documented (third-party binary reads URI from env at startup, not via GetSecret RPC — legitimate
  deviation per context.md 2026-09-02T00:01Z).
- `C-11` (design gate before code) — honored by: this design phase completes before `/sdd-spec` runs.
- `C-14` (consumer surface named) — honored by: consumer surface is the existing Streamable HTTP MCP
  endpoint at port 9000; no new endpoint; UI not affected.
- `C-16` (existing business rules respected) — honored by: three PRESERVE rules from recon.md
  Existing Business Rules section; none changed.
- `F-04` (no invention) — honored by: all unknowns (sqlglot `.key` values) surface as executor
  prerequisites, not guesses; SSE path confirmed from source.
- `F-11` (Floor breaches block approval) — honored by: no unresolved Floor breaches across 3 rounds.
- `P-01` (orchestrator is sole writer) — honored by: subagents advisory only; design.md written
  by orchestrator.
- `P-03` (no silent deviation) — honored by: all fall-through paths in `_is_destructive` log at
  WARNING; MemoryError re-raised rather than swallowed.

---

## Business Rules Touched (C-16)

- PRESERVE `@AC-9 @feature-147` "OAuth txn HMAC-signing with JWT_SECRET" — not regressed by:
  supervisord inherits JWT_SECRET from container env; agent startup sequence unchanged.
- PRESERVE `@AC-8 @feature-147` "MCP_AGENT_SECRET must not appear in any env surface" — not
  regressed by: no new env var resembles the removed secret; POSTGRES_MCP_DATABASE_URI follows
  the credential-env-var pattern, not the removed shared-secret pattern.
- PRESERVE `@AC-8 @feature-156` "real caller x-access-scope forwarded; no hardcoded admin override"
  — not regressed by: `db_*` handlers derive scope from `_caller_access_scope(ctx, tool)`, never
  hardcode `x-access-scope=7`.
