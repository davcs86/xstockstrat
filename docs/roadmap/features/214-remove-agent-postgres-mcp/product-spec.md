# Product Spec: remove-agent-postgres-mcp

**Created**: 2026-09-26

---

## Problem Statement

`xstockstrat-agent` embeds a `postgres-mcp` co-process (crystaldba `postgres-mcp`, feature 169) and
exposes nine `db_*` tools (`db_execute_sql`, `db_list_schemas`, `db_list_objects`,
`db_get_object_details`, `db_explain_query`, `db_get_top_queries`, `db_analyze_workload_indexes`,
`db_analyze_query_indexes`, `db_analyze_db_health`) that let the LLM run SQL against the shared
TimescaleDB as the `xstockstrat_agent` DB role. The agent is a prompt-injectable surface that also
ingests untrusted external content, so this is a standing prompt-injection → arbitrary-SQL path
(security-audit **H-5 / DT-2**, `docs/reports/2026-09-16-trading-system-security-audit.md`).

The prior remediation (feature 212 `sysadmin-db-write-role`, formerly 193, now **demoted**) proposed
privilege-separating the DB tooling into a standalone psql-MCP that was **itself a hardened proxy over
postgres-mcp**. Operator decision (2026-09-26): postgres-mcp is **inherently insecure**, and hardening
a wrapper around it is the wrong posture — **eliminate the surface entirely**. There is no product
need for DB-over-MCP that justifies carrying an arbitrary-SQL attack surface on a prompt-injectable
agent; operators who need admin SQL already have direct, out-of-band database access as DB owners.

## User Story

As a platform operator, I want the agent's `db_*` tools and its postgres-mcp co-process removed
entirely — with no MCP-fronted SQL replacement — so that a prompt-injected or compromised agent
session has no tool, co-process, credential, or network path to execute any SQL, and I run admin SQL
through a sanctioned out-of-band procedure instead.

## Functional Requirements

FR-1. All nine `db_*` tools MUST be removed from `xstockstrat-agent`. After removal an authenticated
`tools/list` returns none of them, and the advertised tool count is **43** (the current 52-tool
baseline minus 9; re-derive against `main-dev` at execute-time).

FR-2. The `postgres-mcp` co-process and all its wiring MUST be removed from the agent: no co-process
in the container (delete the `[program:postgres-mcp]` block from
`services/xstockstrat-agent/supervisord.conf`), no `POSTGRES_MCP_DATABASE_URI` / `POSTGRES_MCP_PORT` /
`POSTGRES_MCP_AGENT_PASSWORD` (or equivalent) configuration anywhere — including the CI/CD secret
injection in `.github/workflows/deploy.yml`, `deploy-dev.yml`, and `deploy-prod.yml` — no code path
that opens a connection to a postgres-mcp SSE endpoint (delete `services/xstockstrat-agent/app/postgres_mcp_client.py`
and its import in `app/tools.py`), and `postgres-mcp` removed from
`services/xstockstrat-agent/pyproject.toml` + `uv.lock` (with `uv lock --check` passing).

FR-3. The agent's direct `xstockstrat_agent` DB connection MUST be removed, the corresponding
connection-pool budget row (`xstockstrat-agent (postgres-mcp)`) in the root `CLAUDE.md` deleted (with
the direct-backend total re-derived), and the **dead `xstockstrat_agent` role-provisioning block** in
`scripts/db-migrate.sh` (feature 169, lines ~169-204) removed along with its `POSTGRES_MCP_AGENT_PASSWORD`
gate. That block only ever created the role when `POSTGRES_MCP_AGENT_PASSWORD` was set; in the live
environments it never was (the `[skip]` path ran), so **no live-DB role exists to drop** — removing the
provisioning code is the complete teardown. (Feature 208, which would have dropped an actually-created
role, is demoted as unnecessary for exactly this reason.)

FR-4. **No replacement SQL-over-MCP surface** is introduced anywhere in the platform. The sanctioned
operator path for admin/DB SQL is out-of-band — a direct `psql`/DB client via SSH / `doctl` /
bastion — documented in a runbook (e.g. `docs/runbooks/operator-db-access.md`).

FR-5. Every tool-count / inventory surface MUST agree on the post-removal count and omit the nine
tools: `services/xstockstrat-ui/src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT` = 43, the agent's
`tests/test_tools_endpoint.py` expected-name set, the `app/tools.py` module docstring,
`services/xstockstrat-agent/CLAUDE.md`, and `docs/runbooks/mcp-tools.md`. The now-dead test files that
exercise the removed surface MUST be deleted or updated so the suite passes with no reference to the
tools/env: `services/xstockstrat-agent/tests/test_db_tools.py` and `tests/test_postgres_mcp_client.py`
(whole-file deletions — they test only the removed tools/client), and
`tests/test_deployment_env_vars.py` (drop the `POSTGRES_MCP_*` env assertions).

FR-6. H-5 is closed by elimination: a prompt-injected agent session instructed to run SQL finds no
`db_*` tool to call, no co-process, no DB credential in its environment, and no reachable SQL endpoint
— no SQL reaches the database through the agent under any input.

## Out of Scope

- A broader "no remaining DB role can write integrity-critical tables" grant audit — not carried by
  this feature (feature 208, which would have done it, is demoted as unnecessary). If ever wanted,
  open a fresh standalone feature. Note there is **no `xstockstrat_agent` role drop to do**: the role
  was never created (see FR-3), so removing its provisioning code is the whole of the DB-side cleanup.
- Any new/replacement DB tooling, read-only or otherwise (explicitly excluded by the operator decision).
- The extract_* SSRF (`207`), the sandbox OS-isolation (`209`), inter-service mTLS (`210`) — sibling
  security follow-ons, independent of this removal.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — owns the nine `db_*` tools (`app/tools.py`), the per-call SSE client
  (`app/postgres_mcp_client.py`, whole-file deletion + its `app/tools.py` import), the postgres-mcp
  co-process launched by the `[program:postgres-mcp]` block in `supervisord.conf` (+ any
  entrypoint/Dockerfile wiring), `pyproject.toml`/`uv.lock`, and the tests
  `tests/test_tools_endpoint.py`, `tests/test_db_tools.py`, `tests/test_postgres_mcp_client.py`,
  `tests/test_deployment_env_vars.py`, plus feature 169's `acceptance/agent-postgres-mcp.feature` suite.
- `xstockstrat-ui` — the `COPILOT_MCP_TOOL_COUNT` mirror in `src/lib/copilot.ts` (FR-5).
- (Deployment/docs) `docker-compose.yml` (agent block), `.do/app.yaml` / `.do/app.dev.yaml` (agent
  `POSTGRES_MCP_*` env), the CI/CD deploy workflows `.github/workflows/deploy.yml`, `deploy-dev.yml`,
  `deploy-prod.yml` (drop the `POSTGRES_MCP_AGENT_PASSWORD` secret injection), `scripts/db-migrate.sh`
  (delete the `xstockstrat_agent` role-provisioning block + its `POSTGRES_MCP_AGENT_PASSWORD` gate,
  ~lines 169-204), root `CLAUDE.md` (pool-budget row + the env-var note that references postgres-mcp),
  `docs/runbooks/mcp-tools.md`, and a new `docs/runbooks/operator-db-access.md`.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tool(s): the nine `db_*` tools are **removed** (a deliberate
  consumer-surface reduction, not a deferral). The capability is not re-homed on any surface; the
  replacement for the legitimate operator need is an out-of-band runbook procedure (FR-4), not a
  platform surface.
- [ ] **UI** — touched only as the count mirror (`copilot.ts`), no user-visible UI change.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys. (Removes the `POSTGRES_MCP_*` env wiring — env vars, not config keys.)

## Database Changes

- [x] No schema changes, and **no live-DB role change**: the `xstockstrat_agent` role was never created
  (its `db-migrate.sh` provisioning is `POSTGRES_MCP_AGENT_PASSWORD`-gated and that env was never set),
  so there is nothing to `DROP`/`REVOKE` on a running database. This feature deletes the dead
  provisioning **shell block** in `scripts/db-migrate.sh` (not a numbered migration) and removes the
  agent's DB *connection* (code/deploy config).

## Feature Workflow Notes

Branch to create: `feature/remove-agent-postgres-mcp` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-agent`) + Security review (closes H-5) + `xstockstrat-ui`
  owner (count mirror) + platform lead (deployment/container cleanup)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A (no numbered migration; the `db-migrate.sh`
  provisioning-block deletion is a shell edit reviewed under the platform-lead deployment gate)

**C-16 CHANGE — sign-off required and RECORDED.** Removing the tools **changes** feature 169's
promoted business rules (`services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`, 13
scenarios). Per Constitution C-16 a CHANGE to an existing durable business rule needs explicit
operator sign-off; that sign-off is the operator's 2026-09-26 "remove all postgres MCP" directive,
recorded in `context.md`. Those 13 scenarios are to be removed/inverted in the same PR.

**Sequencing:** soft rebase-only overlap with `187-opportunities-pagination-drain` on `app/tools.py`
+ `docs/runbooks/mcp-tools.md` (187 lands first, 214 rebases). No downstream feature depends on this
(feature 208 was demoted — see above), and no 084 dependency (the demoted 212's container is gone).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

_All three resolved during the product-spec review gate (2026-09-27), grounded against the codebase;
`/sdd-design` recon will re-verify the exact edit sites._

- [x] **Exact `POSTGRES_MCP_*` env/wiring + launch mechanism — RESOLVED.** Three env vars in use:
  `POSTGRES_MCP_PORT`, `POSTGRES_MCP_DATABASE_URI`, `POSTGRES_MCP_AGENT_PASSWORD`. The co-process is
  launched by **supervisord** via the `[program:postgres-mcp]` block in
  `services/xstockstrat-agent/supervisord.conf` (referenced in `app/postgres_mcp_client.py`), not a
  bespoke `subprocess`/`Popen`. The container entry is `scripts/docker-entrypoint.sh` →
  `supervisord -c /app/supervisord.conf` (agent `Dockerfile`). All surfaces now enumerated in FR-2 /
  Affected Services.
- [x] **Runbook home for FR-4 — RESOLVED:** a new `docs/runbooks/operator-db-access.md` (not a section
  in an existing runbook — the out-of-band admin-SQL procedure is a distinct operator concern).
  macOS/Homebrew-first per the root CLAUDE.md bash-doc rule.
- [x] **`db_*` blast radius — RESOLVED (scope contained):** no external consumer references the nine
  `db_*` tools — nothing in `plugins/strat-lab/`, no other skill, and no `xstockstrat-ui` code beyond
  the documented `COPILOT_MCP_TOOL_COUNT` mirror. All references live inside `xstockstrat-agent`
  (`app/tools.py`, `app/postgres_mcp_client.py`, `CLAUDE.md`, the four tests, the acceptance suite) and
  `docs/runbooks/mcp-tools.md`. Scope does **not** grow beyond the service; the review did surface six
  under-enumerated removal sites (supervisord.conf, postgres_mcp_client.py, three deploy workflows,
  three extra tests) now folded into FR-2 / FR-5 / Affected Services.
