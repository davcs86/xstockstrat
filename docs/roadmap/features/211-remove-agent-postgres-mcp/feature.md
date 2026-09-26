# Feature: remove-agent-postgres-mcp

**Development Branch**: `feature/remove-agent-postgres-mcp`
**Created**: 2026-09-26
**Last Updated**: 2026-09-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-26 | `idea` → `draft` | /sdd-story | Product spec generated. Supersedes demoted feature 193 (`sysadmin-db-write-role`): removes the DB-tool surface outright instead of privilege-separating a hardened proxy over the inherently-insecure postgres-mcp. Closes security-audit H-5 / DT-2 at the trust boundary by elimination. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec remove-agent-postgres-mcp`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Remove **all** postgres-mcp from the platform: delete the nine `db_*` tools and the `postgres-mcp`
co-process from `xstockstrat-agent`, drop its `xstockstrat_agent` DB connection and connection-pool
budget row, and remove the `postgres-mcp` dependency — **with no replacement SQL-over-MCP surface**.
The agent's advertised tool count drops **52 → 43**. postgres-mcp (crystaldba and pgEdge families) was
judged inherently insecure, so the DB-over-MCP surface is eliminated rather than hardened; operators
run admin SQL **out-of-band** (direct `psql`/DB client via SSH/doctl/bastion), documented in a runbook.
A prompt-injected or compromised agent session is thereby left with **no tool, co-process, credential,
or network path to execute any SQL** — closing security-audit finding **H-5** (DT-2) by elimination.
**Supersedes demoted feature 193.** The orphaned `xstockstrat_agent` DB role's grant-level teardown is
carried by feature 208 (`psql-db-role-grant-hardening`).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | The "no prompt-injectable path to SQL" invariant holds by removal (no tool, no co-process, no credential, no route); no residual postgres-mcp SSE endpoint, env, or dependency; H-5 verifiably closed |
| `xstockstrat-agent` | Removal completeness: all nine `db_*` tools + postgres-mcp co-process + `POSTGRES_MCP_*` wiring gone; `pyproject.toml`/`uv.lock` drop `postgres-mcp`; `tests/test_tools_endpoint.py` and the `app/tools.py` docstring updated; feature 169's `acceptance/agent-postgres-mcp.feature` scenarios removed/inverted (C-16) |
| `xstockstrat-ui` | `src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT` mirror 52 → 43, no drift |
| Platform lead | Deployment cleanup: `docker-compose.yml` agent block drops the postgres-mcp co-process; `.do/app*.yaml` drops any `POSTGRES_MCP_*` env; the connection-pool budget row in root CLAUDE.md is removed; coordination with feature 208's role teardown |

## Next Action

`/sdd-review remove-agent-postgres-mcp product-spec` — AI review of product spec before running /sdd-design
