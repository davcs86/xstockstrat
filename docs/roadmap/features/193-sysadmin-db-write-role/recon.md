# Recon: sysadmin-db-write-role (privilege-separated psql MCP)

**Created**: 2026-09-17 (rewritten for the pivoted direction; the prior in-ACL SYSADMIN-bit dossier is in git history at commit `dea933d`)
**From**: product-spec.md (re-baselined)
**Affected services**: xstockstrat-agent (removal), NEW xstockstrat-psql-mcp, xstockstrat-ui (tool-count mirror), deployment/infra (docker-compose, Dockerfiles, .do/app*.yaml, db-migrate.sh)

---

## Objective

Extract all nine `db_*` tools + the `postgres-mcp` co-process out of the prompt-injectable
`xstockstrat-agent` MCP into a standalone **psql MCP** service authenticated on its own out-of-band
credential (independent of xstockstrat OAuth/JWT + access-scope ACL), exposed on its own ingress
endpoint. The injectable agent is left with **no tool, credential, or route to SQL** — closing
security-audit H-5 at the trust boundary rather than via a model-satisfiable in-agent gate.

## Codebase Map

- **`xstockstrat-agent`** (Python — the removal source)
  - The 9 `db_*` tools: thin `@server.tool()` wrappers over `postgres_mcp_client.call_tool(...)`,
    admin-gated `& 0x04`, at `services/xstockstrat-agent/app/tools.py:1955-2077`
    (`db_list_schemas :1955`, `db_list_objects :1966`, `db_get_object_details :1977`,
    `db_execute_sql :1992`, `db_explain_query :2022`, `db_get_top_queries :2033`,
    `db_analyze_workload_indexes :2044`, `db_analyze_query_indexes :2054`, `db_analyze_db_health :2065`).
  - Internal client: `app/postgres_mcp_client.py:26-43` — per-call SSE `ClientSession` to
    `http://localhost:{POSTGRES_MCP_PORT}/sse`, **no auth** (localhost-only isolation).
  - postgres-mcp co-process launch: `supervisord.conf:15` →
    `postgres-mcp --unrestricted --transport sse --port $POSTGRES_MCP_PORT` (localhost bind, no auth flag).
  - Agent MCP framework (reusable for Option A): `mcp` SDK `MCPServer`, Streamable HTTP `/` on :9000,
    OAuth 2.1 aud-bound JWT — `app/main.py:23,63-66,124-128,130-147`; `app/auth.py`; `app/oauth_server.py`.
  - Scope derivation `roles_to_access_scope` `app/scopes.py:39-54` (unchanged by this feature).
- **`postgres-mcp`** = `postgres-mcp` **v0.3.0** (crystaldba), declared `pyproject.toml:18`, pinned
  `uv.lock:1398`. CLI (Context7 `/crystaldba/postgres-mcp`): `--access-mode {unrestricted,restricted}`
  `--transport {stdio,sse,streamable-http}` `--sse-host/--sse-port` — **NO authentication flag**.
- **DB credential/role:** `POSTGRES_MCP_DATABASE_URI` env (docker-compose:552, `.do/app.yaml:310-312`,
  `.do/app.dev.yaml:307-309`); the DML-only `xstockstrat_agent` role (SELECT/INSERT/UPDATE/DELETE, **no
  DDL**) provisioned by `scripts/db-migrate.sh:178-200` (gated on `POSTGRES_MCP_AGENT_PASSWORD`), not a
  numbered migration. Pool budget: 1 direct connection (root `CLAUDE.md:238`;
  `test_deployment_env_vars.py:64` freezes direct-backend total = 9).
- **Tool-count surfaces (49 → 40):** `services/xstockstrat-ui/src/lib/copilot.ts:20`
  (`COPILOT_MCP_TOOL_COUNT`, rendered `CopilotRail.tsx:202`); `tests/test_tools_endpoint.py:23-73`
  (exact name frozenset, db_* at `:64-72`); `app/tools.py:4,45-53` docstring; `CLAUDE.md:43,88-96`;
  `docs/runbooks/mcp-tools.md:3,37`; stale `acceptance/agent-postgres-mcp.feature:41-46` (asserts 42).
- **Deployment:** single agent container, supervisord runs the MCP server + postgres-mcp; agent
  `Dockerfile` (`uv sync --frozen` installs postgres-mcp; entrypoint supervisord); DO agent component
  from a prebuilt GHCR image, `http_port 9000`, ingress `/agent`→agent, `/`→ui
  (`.do/app.yaml:10-21,254-315`; `.do/app.dev.yaml` mirror). A new endpoint = a new DO component
  (own `http_port`) + a new ingress `prefix` rule.

## Candidate Architectures (grounded — the debate's decision set)

- **A. crystaldba postgres-mcp + thin auth-proxy MCP.** A new small service reusing the agent's
  `mcp`-SDK Streamable-HTTP server shape (`app/main.py`) with an **independent static credential**
  (bearer token from a secret/env), fronting a localhost `postgres-mcp` co-process (`--unrestricted`).
  Keeps today's **exact 9 DBA/execute_sql tools + write support**. Most new code (a proxy), full control.
- **B. pgEdge postgres-mcp (native Bearer auth).** *REJECTED (grounded).* It ships native HTTP
  Bearer-token auth + token file (`PGEDGE_AUTH_*`) — attractive — BUT its tool model is a mismatch:
  flagship `query_database` runs **read-only transactions blocking INSERT/UPDATE/DELETE/DDL**
  (Context7: security_mgmt), the tool set is NL/RAG-oriented (`query_database`, `similarity_search`,
  `generate_embedding`, `search_knowledgebase`, `count_rows`) not the DBA/`execute_sql` surface, and it
  pulls an LLM/embedding dependency (`PGEDGE_ANTHROPIC_API_KEY`). It cannot serve the privileged raw-SQL
  write role without abandoning tool parity.
- **C. crystaldba postgres-mcp + generic auth gateway.** postgres-mcp behind an auth-enforcing
  reverse proxy / MCP gateway (e.g. oauth2-proxy) that checks a bearer credential and forwards MCP-over-
  HTTP. No custom MCP code; adds a gateway container (post-nginx-removal, feature 045, this is net-new
  infra) and must pass the MCP Streamable-HTTP/SSE protocol through cleanly.

## Patterns to REUSE

- **The agent's `mcp`-SDK Streamable-HTTP server scaffold** (`app/main.py:63-66,124-128`) + the
  `postgres_mcp_client.py` SSE forwarder — for Option A, the psql MCP is largely this shape minus the
  OAuth/JWT gate, plus an independent credential check. Do NOT rebuild an MCP server from scratch.
- **The supervisord co-process model** (`supervisord.conf`) — the psql MCP runs postgres-mcp as its own
  localhost co-process exactly as the agent does today.
- **The DML-only role provisioning** (`scripts/db-migrate.sh:178-200`) — retained/re-labeled; do NOT
  broaden grants (DDL stays denied at the grant level → preserves feature-169 `@AC-4`).
- **The tool-count lockstep surfaces** — update all six in one change (C-10 duplicated-value case).
- **Env-binding of the DB URI** (deployment-time, not a config-service key) — the psql MCP's own
  credential follows the existing secret/env convention.

## Existing Business Rules (preserve / extend / change)

_Constitution **C-16** — feature-169 `services/xstockstrat-agent/acceptance/agent-postgres-mcp.feature`;
operator has signed off on the pivot (`context.md`)._
- **CHANGE** `@AC-12`/`@AC-13` (confirm-gate: dry-run without confirm / execute with confirm) —
  **removed**; the client-side model-satisfiable confirm gate is gone. The relocated psql MCP executes
  writes for an authenticated operator with no confirm dance.
- **CHANGE** `@AC-9` (agent tool count 42 + `db_` prefix contract) — the count drops (49→40 on the
  current baseline) and the `db_` prefix leaves the agent surface entirely.
- **CHANGE (relocate)** `@AC-5` (admin invokes a `db_` tool through the agent) — no `db_` tool exists on
  the agent anymore; the capability moves to the psql MCP under its own auth.
- **PRESERVE (relocate)** `@AC-4` (DML role: INSERT ok, CREATE TABLE denied) — the DML/DDL grant
  boundary is retained on the psql MCP's DB role.
- **PRESERVE** `@AC-6`/`@AC-7` (non-admin / unauthenticated denied `db_` tools) — the *principle* holds
  on the new surface (unauthenticated → denied), now enforced by the psql MCP's own credential, not the
  agent's `& 0x04`.
- **PRESERVE** the agent's own OAuth/JWT gate for its remaining 40 tools (unchanged).

## Dependencies

- Proto/RPC: **none**.
- Migration: **none** (DML role via `db-migrate.sh`, retained/re-labeled).
- Config keys: **none** (env-bound deployment bindings; the psql MCP credential is a secret/env).
- Inter-service edges: the psql MCP → Postgres (direct, 1 connection). The agent **loses** its edge to
  postgres-mcp. No new gRPC edges.
- New env vars / ports: the psql MCP's `http_port` + its credential var + a `POSTGRES_MCP_*` binding
  (moved from the agent). New DO component + ingress `prefix`.

## Risks / Not-found

- **[Deployment coordination — WARN, overlap with 084]** `084-droplet-compose-deploy` (`spec-ready`)
  restructures dev deployment around Caddy blue/green and asserts the public surface "does not widen."
  The psql MCP's new component + ingress route must be reconciled into whichever topology lands — a
  design-time decision, revisit for a merge-order entry once both have impl-specs.
- **[Rebase — WARN, overlap with 187]** `187-opportunities-pagination-drain` (`in-progress`) edits
  `tools.py`/`mcp-tools.md` in disjoint functions; 187 lands first, 193 rebases its `db_*` removals.
- **[Auth mechanism — design fork]** Option A (custom proxy credential) vs Option C (gateway). The
  independent credential must NOT reuse/forward a blanket xstockstrat `x-access-scope` (fails.md
  2026-08-05). The exact credential (static bearer/API key vs basic vs token file) is a design pick.
- **[Reachability threat model]** Operator chose "separate authenticated endpoint" (public ingress
  route gated by its own credential). That single credential is then the entire boundary — design must
  ensure the injectable agent has no way to obtain/forward it and no network route (FR-4). Consider
  whether the endpoint should additionally be network-restricted.
- **[postgres-mcp access-mode]** Keep `--unrestricted` (legitimate write path); the boundary is the
  fronting auth + off-injectable-surface, not the vendor flag. DDL still denied by the DML role.
- **[Tool-count invariant]** 49→40 must update all six surfaces in lockstep or CI fails
  (`copilot.ts`, `test_tools_endpoint.py`, docstring, CLAUDE.md, mcp-tools.md) + re-author the stale
  feature-169 acceptance count.
- **[Not found]** The `xstockstrat_agent` role is not a numbered migration; provisioned by shell in
  `db-migrate.sh`. No existing standalone-service scaffold for a non-agent MCP — Option A builds the
  first one (reusing the agent's server code as the template).

## Recommended Scope

_Advisory step boundaries — input to the grilling and `/sdd-spec`._
1. **Stand up the psql MCP service** (chosen architecture A or C): new service dir + Dockerfile +
   process model (postgres-mcp co-process), independent-credential auth, own `http_port`. (Covers @AC-4,
   @AC-5, @AC-7 relocated; @AC-9 new-endpoint side.)
2. **Independent auth** — the credential check, provisioned out-of-band; a valid xstockstrat JWT is
   rejected. (Covers @AC-6, @AC-7; the FR-3/FR-4 invariant.)
3. **Remove db_* from the agent** — delete the 9 tool defs + `postgres_mcp_client.py` usage + the
   supervisord postgres-mcp entry + `POSTGRES_MCP_*` agent env; update all six tool-count surfaces to 40.
   (Covers @AC-1, @AC-2, @AC-3.)
4. **DB role + pool budget** — retain the DML-only role on the psql MCP; re-label the pool-budget row.
   (Covers @AC-9-DML-relocated, @AC-10.)
5. **Deployment wiring** — docker-compose service + `.do/app*.yaml` component + ingress route;
   coordinate with 084. (Covers @AC-8.)
