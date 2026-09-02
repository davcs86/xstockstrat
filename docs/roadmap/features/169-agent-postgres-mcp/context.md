# Context: agent-postgres-mcp

**Feature**: `docs/roadmap/features/169-agent-postgres-mcp/feature.md`
**Product Spec**: `docs/roadmap/features/169-agent-postgres-mcp/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/169-agent-postgres-mcp/implementation-spec.md`

---

## Session 2026-09-02T00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Feature number: **169** (max existing was 168).
- Key design decisions locked in via AskUserQuestion before story creation:
  - Process model: **supervisord** as PID 1 in the agent container (not a separate service, not systemd).
  - Exposure: **aggregated** into the existing Streamable HTTP MCP endpoint — agent becomes MCP client of local postgres-mcp.
  - DB access: **restricted mode + dedicated read-only Postgres role** (`xstockstrat_readonly`).
  - Target DB: **shared TimescaleDB** (all schemas, read-only).
  - Authorization: **admin-only** (`x-access-scope` bit `0x04`) — added as FR-5 after user clarification post-story-start interrupt.
- `POSTGRES_MCP_DATABASE_URI` and `POSTGRES_MCP_PORT` are env vars (not config-service keys) because they carry DB credentials.
- Tool names prefixed `db_` (FR-6) to prevent collision with existing 33-tool surface.
- Known traps from ledger incorporated into product-spec Open Questions:
  - MCP surface drift (6 inventory surfaces — ledger 2026-08-02).
  - Dockerfile entrypoint replacement pattern (ledger 2026-08-05).

## Session 2026-09-02T00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: @AC-5 Then clause uses qualitative language ("a 'status' field indicating database connectivity") — spec reviewer recommends naming the concrete expected field value before impl-spec is written (advisory C-15; not a blocker).
- Overlap findings:
  - WARN: `docker-compose.yml` — shared with `084-droplet-compose-deploy` (FR-3 restructures all port bindings + Caddy). Whichever merges second does a manual integration merge.
  - WARN: `.do/app.dev.yaml` — semantic incompatibility if 084 merges first: 084 abandons `.do/app.dev.yaml` for dev deploys (replaces with Droplet SSH). If 084 lands first, 169's FR-9 dev-env wiring must switch to 084's secrets-injection mechanism (`.env` or secrets manager on Droplet) rather than editing `.do/app.dev.yaml`. Executor must check 084 merge status before executing FR-9.
- Blockers fixed before review:
  - @AC-9: replaced non-concrete 'N determined at implementation time' with exact enumeration of 9 db_* tools confirmed from crystaldba/postgres-mcp HEAD.
  - @AC-5/@AC-6: corrected placeholder tool names (db_health→db_analyze_db_health, db_explain→db_explain_query).
  - OQ-1/OQ-2/OQ-3: all closed via crystaldba repo inspection + PyPI lookup.

## Session 2026-09-02T00:00Z — scope revision (write access)

User clarified the ultimate goal: agents need to **debug and make targeted data fixes directly on the DB**, not just read-only introspection. This invalidated three locked design decisions:

- postgres-mcp mode: `--restricted` → `--unrestricted` (restricted mode blocks writes; safety delegated to role privileges + agent gate)
- Postgres role: `xstockstrat_readonly` (SELECT only) → `xstockstrat_agent` (SELECT + INSERT + UPDATE + DELETE; no DDL, no TRUNCATE)
- New FR-11: approval gate in the agent tool handler — `db_execute_sql` calls containing UPDATE/DELETE/DROP tokens return a dry-run response requiring `confirm=true` before forwarding to postgres-mcp

Design decisions (from AskUserQuestion before revision):
- Write scope: DML only (no DDL/TRUNCATE)
- Approval gate: destructive ops only (UPDATE/DELETE/DROP) — SELECT/INSERT execute immediately
- Topology: remains co-process inside agent, proxied through existing OAuth-protected endpoint

Status reverted to `draft` for re-review (`/sdd-review agent-postgres-mcp product-spec`).
Files changed: product-spec.md (FR-2, FR-3, FR-11, Out-of-Scope, Consumer Surfaces, DB Changes, Workflow Notes, OQ-1), acceptance.feature (@AC-4, @AC-11, +@AC-12, +@AC-13).
