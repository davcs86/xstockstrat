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

## Session 2026-09-02T00:00Z — sdd-review product-spec (third pass, post-DML revision)

- Product spec approved. Status: draft → spec-ready.
- Warnings (advisory, no blockers):
  - @AC-5 Then clause accepts "ok" or "healthy" — dual-value expected result driven by upstream postgres-mcp return shape; impl-spec should narrow or document the range.
  - FR-7 previously cited stale 2026-07-20 ledger entry (5 surfaces); fixed inline to enumerate all 6 surfaces explicitly, naming copilot.ts (the surface with documented miss history, fails.md).
  - @AC-9/@AC-10 Then clauses are static-file assertions (not runtime) — impl-spec should wire CI/grep enforcement.
- Overlap: same 3 WARN-level file clashes with 084-droplet-compose-deploy (unchanged). No FAIL-level collision.
- Fixes applied before gate passed:
  - FR-8: 'read-only role' → 'DML-capable role (xstockstrat_agent)'
  - FR-9: xstockstrat_readonly → xstockstrat_agent in DO app spec reference
  - FR-11: added TRUNCATE to destructive-token gate
  - AC-5: qualitative Then replaced with concrete field-shape assertion
  - AC-10: both xstockstrat_readonly references → xstockstrat_agent
  - FR-7 / AC-9: enumerated all 6 inventory surfaces, added copilot.ts explicitly

## Session 2026-09-02 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-agent, xstockstrat-ui; key reuse patterns: `_caller_access_scope` admin gate, uv/Dockerfile layering discipline).
- Phase 1 Grilling: 3 rounds (quick; user-extended to 3). Chosen approach: supervisord as PID 1, per-call SSE client, fail-closed three-tier FR-11 gate (sqlglot primary → Command-node safe-default → regex fallback on ParseError). Rejected: long-lived SSE session, separate service, fail-open Command-node branch, regex-only FR-11.
- Constitution rules touched: C-01, C-02, C-10/PLAT-4, C-11, C-14, C-16, F-04, F-11, P-01, P-03. Floor breaches: none.
- Open risks carried to /sdd-spec: (1) sqlglot `.key` value verification (executor prerequisite before FR-11); (2) 084-droplet-compose-deploy overlap on docker-compose/app.yaml/app.dev.yaml; (3) unit test TRUNCATE→True regardless of branch.
- Status: spec-ready → design-approved.

## Session 2026-09-02T00:01Z — warning fixes (pre-design)

Advisory warnings from the third spec review resolved before /sdd-design:

- **@AC-5 return-shape correction**: Inspected crystaldba/postgres-mcp HEAD
  (`src/postgres_mcp/database_health/database_health.py`). `db_analyze_db_health` does NOT
  return a JSON object with a "status" key — it returns a plain text string with labeled section
  headers (index, connection, vacuum, sequence, replication, buffer, constraint). The prior
  assertion ("top-level 'status' key with value 'ok' or 'healthy'") was factually wrong.
  Fixed `Then` in @AC-5: "non-empty text tool result containing at least one of the labeled
  section keywords ('index', 'connection', 'vacuum', 'sequence', 'replication', 'buffer', or
  'constraint')". Arguments also made explicit: `{"health_type": "all"}` (the upstream default).

- **@AC-9 static vs. runtime enforcement**: Added a fourth `Then` clause explicitly distinguishing
  documentation surfaces (verified by PR diff review) from runtime surfaces
  (tests/test_tools_endpoint.py + copilot.ts constant, enforced by CI test suite). No scenario
  logic changed — only the enforcement mechanism is now documented inline.

- **@AC-10 CLAUDE.md assertion**: Added "(verified by PR diff review)" to the `Then` clause
  about the connection budget table in root CLAUDE.md, distinguishing it from the runtime
  pg_stat_activity assertion above it.

- **Credential deviation note**: `POSTGRES_MCP_DATABASE_URI` deviates from the feature-147 pattern
  (encrypted config rows via `GetSecret`). Deviation is legitimate — crystaldba/postgres-mcp is a
  third-party binary that reads its DB URI at process startup from an env var, not via an RPC.
  Impl-spec should note this deviation explicitly (Constitution C-10 / PLAT-4).
