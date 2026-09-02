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
