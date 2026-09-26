# Context: remove-agent-postgres-mcp

**Feature**: `docs/roadmap/features/211-remove-agent-postgres-mcp/feature.md`
**Product Spec**: `docs/roadmap/features/211-remove-agent-postgres-mcp/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/211-remove-agent-postgres-mcp/implementation-spec.md`

---

## Session 2026-09-26 — sdd-story (supersedes demoted feature 193)

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from operator
  directive: **"remove all postgres MCP, they are inherently insecure."**
- **Supersedes feature 193 (`sysadmin-db-write-role`)**, demoted the same day. 193's chosen design
  privilege-separated the DB tooling into a standalone `xstockstrat-psql-mcp` that was itself a
  transparent proxy over postgres-mcp. The operator judged postgres-mcp (crystaldba **and** pgEdge
  families) inherently insecure, so hardening a wrapper around it is rejected — the surface is
  **eliminated**. This closes H-5 / DT-2 by removal rather than separation.
- **Scope = pure removal**, drawn from the "extract-out" half of 193's design minus the "build a new
  home" half:
  - Remove the 9 `db_*` tools + postgres-mcp co-process from `xstockstrat-agent`; tool count 52 → 43.
  - Remove `postgres-mcp` from `pyproject.toml`/`uv.lock`; remove `POSTGRES_MCP_*` wiring and the
    co-process from the container / docker-compose / `.do/app*.yaml`.
  - Remove the agent's direct DB connection + its connection-pool budget row in root CLAUDE.md.
  - **No replacement SQL-over-MCP surface.** Out-of-band `psql` via SSH/doctl/bastion, documented in
    a runbook (FR-4).
- **C-16 CHANGE sign-off (P-05):** removal **changes** feature 169's 13 promoted `agent-postgres-mcp`
  business-rule scenarios. Operator's 2026-09-26 directive is the recorded sign-off; the 13 scenarios
  are removed/inverted in the same PR.
- **Boundary with feature 208:** 211 removes the agent's *use* of the `xstockstrat_agent` role; the
  role's grant-level drop/revoke is feature 208 (`psql-db-role-grant-hardening`, rescoped to
  orphaned-role teardown). 211 lands **before** 208.
- **No 084 dependency** — the demoted 193's on-demand droplet container is gone; this is a removal
  with no new service and no deployment substrate need.
- Baseline facts to re-derive at recon/execute: `copilot.ts` `COPILOT_MCP_TOOL_COUNT` (was 52),
  `app/tools.py` docstring ("Fifty-two tools"), the 9 `db_*` names, `postgres-mcp==0.3.0` in `uv.lock`,
  and the `agent-postgres-mcp.feature` 13-scenario count. Open forks in product-spec § Open Questions.
- **Ledger:** the generalizable lesson ("when a fronted dependency is inherently insecure, eliminate
  the surface rather than build/maintain a hardened wrapper — attack-surface minimization / YAGNI over
  privilege-separation scaffolding") is appended to `docs/roadmap/ledger/insights.md` this session.
