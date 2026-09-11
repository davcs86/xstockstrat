# Product Spec: agent-postgres-mcp

**Created**: 2026-09-02

---

## Problem Statement

Platform operators and admins have no direct, authenticated path to diagnose and fix issues in the live TimescaleDB cluster — checking slow-query candidates, reviewing index health, running EXPLAIN plans, or making targeted data corrections requires raw DB credentials and a psql session. The `crystaldba/postgres-mcp` server solves this generically; wiring it into the agent exposes those capabilities — including controlled DML writes — through the same OAuth-protected surface Claude.ai already uses, without opening a new public port or bypassing the admin gate.

## User Story

As an **admin operator**, I want to invoke Postgres analysis and data-manipulation tools (EXPLAIN, index recommendations, schema introspection, DB health checks, and targeted INSERT/UPDATE/DELETE) through the existing xstockstrat MCP endpoint, so that I can diagnose query performance, inspect schemas, and make targeted data fixes without needing direct DB credentials or a separate tool connection.

## Functional Requirements

FR-1. `postgres-mcp` runs as a **second process** inside the `xstockstrat-agent` container, managed by **supervisord** (replacing the current single `CMD` entrypoint). Both processes — `app.main` (the existing MCP/OAuth server) and `postgres-mcp` (the DB analysis server) — must be supervised: crash of either triggers a restart; supervisord is PID 1.

FR-2. `postgres-mcp` runs in **unrestricted mode** (`--transport sse` without `--restricted`), bound to `localhost` only, inaccessible from outside the container. Safety is enforced by the Postgres role's privilege grants (FR-3) and the agent-layer approval gate (FR-11) — not by postgres-mcp's own mode restriction.

FR-3. `postgres-mcp` connects to the shared TimescaleDB via a **dedicated DML-capable Postgres role** (`xstockstrat_agent`) whose credentials are injected at runtime via the `POSTGRES_MCP_DATABASE_URI` env var. This role has `SELECT`, `INSERT`, `UPDATE`, `DELETE` on all schemas; `CONNECT` on the database; explicitly no `CREATE`, `DROP`, `ALTER`, or `TRUNCATE`. The role must not reuse any existing service credentials.

FR-4. The `xstockstrat-agent` (`app.main`) connects to the local `postgres-mcp` instance as an **MCP client** (SSE transport on `localhost:<POSTGRES_MCP_PORT>`) and re-exposes its tools under the existing Streamable HTTP endpoint (`/`) — no new public port, no new auth surface.

FR-5. Every postgres-mcp tool re-exposed through the agent is **admin-gated**: the agent checks the caller's `x-access-scope` admin bit (`0x04`) before forwarding the call to `postgres-mcp`. A non-admin caller receives `PERMISSION_DENIED`. This mirrors the existing `_caller_access_scope` + backend-gate pattern used by `trigger_backfill` and `manage_signal_source`, except the gate lives in the agent (no gRPC backend to delegate to).

FR-6. Tool names re-exposed from `postgres-mcp` are prefixed with `db_` to prevent collisions with existing xstockstrat tool names and to make their origin self-documenting (e.g. `db_health`, `db_explain`, `db_index_recommendations`).

FR-7. All **six** tool-inventory surfaces must be updated atomically in the same PR (ledger insight 2026-07-20, extended by feature 164 2026-09-01 — copilot.ts is the sixth surface with a documented history of being missed, `docs/roadmap/ledger/fails.md`):
  1. `services/xstockstrat-agent/app/tools.py` — module docstring tool count + enumeration
  2. `services/xstockstrat-agent/CLAUDE.md` — tool count + table rows
  3. `docs/runbooks/mcp-tools.md` — header tool count
  4. `docs/runbooks/mcp-tools.md` — per-tool reference entries (parameters, return shape, "Admin-only" annotation for all `db_*` tools)
  5. `tests/test_tools_endpoint.py` — exact-name set assertion
  6. `services/xstockstrat-ui/src/lib/copilot.ts` — `COPILOT_MCP_TOOL_COUNT` constant

FR-8. The connection-pool budget is respected: `postgres-mcp` uses at most **1 direct connection** to TimescaleDB (DML-capable role `xstockstrat_agent`, direct port `:25060`). This is a new direct slot — update the connection budget table in root `CLAUDE.md`.

FR-9. Local `docker-compose.yml` injects `POSTGRES_MCP_DATABASE_URI` pointing at the local TimescaleDB. DO App Platform dev/prod app specs (`.do/app.dev.yaml`, `.do/app.yaml`) inject the same var from the managed-DB connection string for the `xstockstrat_agent` role.

FR-10. The `Dockerfile` for `xstockstrat-agent` installs `postgres-mcp` (via `uv` in `pyproject.toml`) and `supervisord` (system package or Python), and replaces the `CMD` entrypoint with a `supervisord.conf` that manages both processes.

FR-11. The agent's `db_execute_sql` tool handler intercepts calls whose `sql` argument contains any of the tokens `UPDATE`, `DELETE`, `DROP`, or `TRUNCATE` (case-insensitive, checked before forwarding). On first invocation without `confirm=true`: the agent returns a dry-run response showing the SQL statement, a plain-language description of the destructive operation, and the message `"Destructive operation requires confirmation. Re-invoke with confirm=true to execute."` — the query is **not** forwarded to postgres-mcp. On re-invocation with `confirm=true`: the agent forwards the call to postgres-mcp and returns the result. `INSERT` and `SELECT` are forwarded immediately without a confirmation step. This gate is in the agent tool handler, independent of the postgres-mcp process.

## Out of Scope

- Creating the `xstockstrat_agent` Postgres role is a **one-time DBA step** documented in the implementation spec as a runbook entry; it is not automated by this feature's application code.
- **DDL and TRUNCATE** (`CREATE TABLE`, `DROP TABLE`, `ALTER TABLE`, `CREATE INDEX`, `TRUNCATE`) — the `xstockstrat_agent` role is granted no DDL privileges; any DDL attempt will be rejected at the Postgres level.
- Any new public port or separate DO App Platform component for `postgres-mcp`.
- UI segment for the DB tools — operator access is via Claude.ai → agent MCP only.
- Exposing `postgres-mcp` to non-admin MCP callers.

## Affected Services

- `xstockstrat-agent` — container entrypoint replaced (supervisord), new co-process (postgres-mcp), new MCP client wiring, new admin-gated tool re-exposure, updated tool inventory.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tool(s) — exactly 9 tools, all new, all admin-only (confirmed 2026-09-02 by inspecting crystaldba/postgres-mcp HEAD; unrestricted mode, DML writes enabled):
  `db_list_schemas`, `db_list_objects`, `db_get_object_details`, `db_execute_sql` (SELECT+INSERT immediate; UPDATE/DELETE/DROP gated by FR-11 confirmation step),
  `db_explain_query`, `db_get_top_queries`, `db_analyze_workload_indexes`,
  `db_analyze_query_indexes`, `db_analyze_db_health`.
- [ ] **UI** — No new UI surface; DB introspection is ops/admin only, agent-only.
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required — tool re-exposure is in-process Python MCP client/server; no new gRPC RPCs.

## Config Key Changes

- [ ] No new config keys — `POSTGRES_MCP_DATABASE_URI` and `POSTGRES_MCP_PORT` are **environment variables** (infrastructure-level, runtime-injected), not config-service keys. They contain a DB credential and must not pass through the config service.

## Database Changes

- [x] No schema changes — the `xstockstrat_agent` role creation is a Postgres-level DBA operation (DDL run once against the cluster), not a golang-migrate migration against a service schema.

> **Known trap (DBA gate):** The DBA approval gate applies here for the role creation even though it does not touch service-schema migration files. Document the `CREATE ROLE` / `GRANT SELECT, INSERT, UPDATE, DELETE` SQL in the implementation spec so DBA review can happen before execution. DBA should also confirm that granting DML (not just SELECT) on all schemas to a new role meets the platform's data-access policy.

## Feature Workflow Notes

Branch to create: `feature/agent-postgres-mcp` (branch from `main-dev`)
Approval gates required:
- [x] 1 service owner approval (`xstockstrat-agent` — non-breaking, no proto change)
- [x] DBA review + service owner (`xstockstrat_agent` role creation with DML privileges — no golang-migrate migration but a real DB privilege change granting writes)
- [x] Security review (admin gate, credential injection, DML role scoping, FR-11 approval-gate implementation)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution **C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **Exact postgres-mcp tool names (unrestricted mode)** — Confirmed 2026-09-02 by inspecting crystaldba/postgres-mcp HEAD. Unrestricted mode exposes 9 tools; DML safety enforced by `xstockstrat_agent` role privileges + FR-11 agent gate. Full list with `db_` prefix mapping: `db_list_schemas`, `db_list_objects`, `db_get_object_details`, `db_execute_sql`, `db_explain_query`, `db_get_top_queries`, `db_analyze_workload_indexes`, `db_analyze_query_indexes`, `db_analyze_db_health`.
- [x] **supervisord vs. s6/tini** — `supervisor` v4.3.0 is a pure-Python package on PyPI; installable via `uv add supervisor`. No `apt-get` step required in the Dockerfile — `uv sync` handles it as part of normal Python dependency resolution.
- [x] **`postgres-mcp` SSE transport port** — Default SSE port is **8000** (confirmed from crystaldba/postgres-mcp docs). The agent's only occupied internal port is 9000 (HTTP MCP endpoint); 8000 is free. Set `POSTGRES_MCP_PORT` default to `8000`.

> **Known trap (MCP surface drift, ledger 2026-08-02):** New `db_*` tools add to the six-surface inventory. Every surface must be updated atomically in the same PR. Use the descriptor-parity test pattern from `test_backtest_view.py` as the guard.

> **Known trap (Dockerfile entrypoint, ledger 2026-08-05 nginx/agent):** Switching from `CMD` to supervisord-as-PID-1 requires ensuring the `ENTRYPOINT ["/docker-entrypoint.sh"]` still runs (or is replaced). The current `docker-entrypoint.sh` does `exec "$@"` — with supervisord as CMD, it will `exec supervisord`, which is correct. Verify the WAIT_FOR dep-probe still fires before supervisord starts both processes.
