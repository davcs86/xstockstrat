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

The prior remediation (feature 193, now **demoted**) proposed privilege-separating the DB tooling into
a standalone psql-MCP that was **itself a hardened proxy over postgres-mcp**. Operator decision
(2026-09-26): postgres-mcp is **inherently insecure**, and hardening a wrapper around it is the wrong
posture — **eliminate the surface entirely**. There is no product need for DB-over-MCP that justifies
carrying an arbitrary-SQL attack surface on a prompt-injectable agent; operators who need admin SQL
already have direct, out-of-band database access as DB owners.

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
in the container, no `POSTGRES_MCP_DATABASE_URI` / `POSTGRES_MCP_PORT` (or equivalent) configuration,
no code path that opens a connection to a postgres-mcp SSE endpoint, and `postgres-mcp` removed from
`services/xstockstrat-agent/pyproject.toml` + `uv.lock` (with `uv lock --check` passing).

FR-3. The agent's direct `xstockstrat_agent` DB connection MUST be removed, and the corresponding
connection-pool budget row (`xstockstrat-agent (postgres-mcp)`) in the root `CLAUDE.md` deleted, with
the direct-backend total re-derived. (Dropping/revoking the `xstockstrat_agent` **role** at the
Postgres grant level is feature 208's scope — see § Feature Workflow Notes.)

FR-4. **No replacement SQL-over-MCP surface** is introduced anywhere in the platform. The sanctioned
operator path for admin/DB SQL is out-of-band — a direct `psql`/DB client via SSH / `doctl` /
bastion — documented in a runbook (e.g. `docs/runbooks/operator-db-access.md`).

FR-5. Every tool-count / inventory surface MUST agree on the post-removal count and omit the nine
tools: `services/xstockstrat-ui/src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT` = 43, the agent's
`tests/test_tools_endpoint.py` expected-name set, the `app/tools.py` module docstring,
`services/xstockstrat-agent/CLAUDE.md`, and `docs/runbooks/mcp-tools.md`.

FR-6. H-5 is closed by elimination: a prompt-injected agent session instructed to run SQL finds no
`db_*` tool to call, no co-process, no DB credential in its environment, and no reachable SQL endpoint
— no SQL reaches the database through the agent under any input.

## Out of Scope

- The grant-level teardown/revocation of the now-orphaned `xstockstrat_agent` DB role — **feature 208
  (`psql-db-role-grant-hardening`)**, rescoped for exactly this. 211 removes the agent's *use* of the
  role; 208 removes the role's *privileges* at the DB.
- Any new/replacement DB tooling, read-only or otherwise (explicitly excluded by the operator decision).
- The extract_* SSRF (`207`), the sandbox OS-isolation (`209`), inter-service mTLS (`210`) — sibling
  security follow-ons, independent of this removal.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — owns the nine `db_*` tools (`app/tools.py`), the postgres-mcp co-process +
  its supervisord/entrypoint/Dockerfile wiring, `pyproject.toml`/`uv.lock`, `tests/test_tools_endpoint.py`,
  and feature 169's `acceptance/agent-postgres-mcp.feature` suite.
- `xstockstrat-ui` — the `COPILOT_MCP_TOOL_COUNT` mirror in `src/lib/copilot.ts` (FR-5).
- (Deployment/docs) `docker-compose.yml` (agent block), `.do/app.yaml` / `.do/app.dev.yaml` (agent
  env, if any `POSTGRES_MCP_*` present), root `CLAUDE.md` (pool-budget row + the env-var note that
  references postgres-mcp), `docs/runbooks/mcp-tools.md`, and a new `docs/runbooks/operator-db-access.md`.

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

- [x] No schema changes in this feature. The orphaned-role drop/revoke migration is **feature 208**.
  211 removes only the agent's *connection* to the DB (code/deploy config), not any schema or grant.

## Feature Workflow Notes

Branch to create: `feature/remove-agent-postgres-mcp` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-agent`) + Security review (closes H-5) + `xstockstrat-ui`
  owner (count mirror) + platform lead (deployment/container cleanup)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A here; applies to feature 208

**C-16 CHANGE — sign-off required and RECORDED.** Removing the tools **changes** feature 169's
promoted business rules (`services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`, 13
scenarios). Per Constitution C-16 a CHANGE to an existing durable business rule needs explicit
operator sign-off; that sign-off is the operator's 2026-09-26 "remove all postgres MCP" directive,
recorded in `context.md`. Those 13 scenarios are to be removed/inverted in the same PR.

**Sequencing:** soft rebase-only overlap with `187-opportunities-pagination-drain` on `app/tools.py`
+ `docs/runbooks/mcp-tools.md` (187 lands first, 211 rebases). 211 should land **before** feature 208
(208 tears down the DB role that 211 orphans). No 084 dependency (the demoted 193's container is gone).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Confirm the exact `POSTGRES_MCP_*` env/wiring names and the supervisord/entrypoint mechanism in
  the current agent container at `/sdd-design` recon (grounded against `services/xstockstrat-agent/`).
- [ ] Runbook home for FR-4: new `docs/runbooks/operator-db-access.md` vs a section in an existing
  runbook — decide at `/sdd-design`. Must be macOS/Homebrew-first per root CLAUDE.md bash-doc rule.
- [ ] Does anything besides the agent import or reference the `db_*` tools (e.g. the `strat-lab`
  plugin, other skills)? Recon must confirm the blast radius before removal.
