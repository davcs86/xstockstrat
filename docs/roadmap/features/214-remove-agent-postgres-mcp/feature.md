# Feature: remove-agent-postgres-mcp

**Development Branch**: `feature/remove-agent-postgres-mcp`
**Created**: 2026-09-26
**Last Updated**: 2026-09-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-26 | `idea` → `draft` | /sdd-story | Product spec generated. Supersedes demoted feature 212 (`sysadmin-db-write-role`, formerly 193): removes the DB-tool surface outright instead of privilege-separating a hardened proxy over the inherently-insecure postgres-mcp. Closes security-audit H-5 / DT-2 at the trust boundary by elimination. |
| 2026-09-27 | `draft` (renumbered) | operator | **Renumbered 211 → 214.** The original number (211) collided with `211-edgar-fundamentals-enrichment`, which merged to `main-dev`/`main` while this feature's PR was in flight. Slug and content unchanged; NNN moved to the next free value. |
| 2026-09-27 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS, 0 blockers). Review warnings addressed before advancing: all three Open Questions resolved, and 6 under-enumerated removal sites folded into FR-2/FR-5/Affected Services (supervisord.conf `[program:postgres-mcp]`, app/postgres_mcp_client.py, 3 deploy workflows, 3 extra tests). Overlap: WARN-only (soft/rebase, no FAIL). |
| 2026-09-28 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Adversary caught a 3rd orphaned dep (`httpx2`) + 2 more dep-smoke assertions, all folded in; C-16 delete-and-promote chosen (@AC-7 reworded); no Floor breach. |
| 2026-09-28 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps. Every edit site confirmed against `main-dev` (52-tool baseline, direct-total 9, all `POSTGRES_MCP_*` deploy sites, db-migrate.sh block, 6 test files, C-16 suite). |
| 2026-09-28 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started. Impl-spec review's 4 advisory warnings resolved pre-execution. Step 1 landed (db_* tools + orphans removed). |
| 2026-09-28 | `in-progress` → `code-completed` | /sdd-execute | All 12 steps landed (sequential). db_* tools + postgres-mcp co-process + deps + deploy wiring + dead role block removed; count 52→43; direct budget 9→8; C-16 delete-and-promote; operator-db-access runbook added. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map + removal surface (Phase 0)
- [Design](design.md) — chosen approach, rejected alternatives, Constitution/C-16 rules touched (Phase 1)
- [Implementation Spec](implementation-spec.md) — 12 numbered steps with codebase evidence (Phase 2)
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
**Supersedes demoted feature 212** (`sysadmin-db-write-role`, formerly 193). This feature also removes
the dead `xstockstrat_agent` role-provisioning block from `scripts/db-migrate.sh` (feature 169): that
block only created the role when `POSTGRES_MCP_AGENT_PASSWORD` was set, and that password was never set
in the live environments, so the role was **never created** — there is no DB-side role to tear down
(feature 208, which would have done that teardown, is demoted as unnecessary).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | The "no prompt-injectable path to SQL" invariant holds by removal (no tool, no co-process, no credential, no route); no residual postgres-mcp SSE endpoint, env, or dependency; H-5 verifiably closed |
| `xstockstrat-agent` | Removal completeness: all nine `db_*` tools + postgres-mcp co-process + `POSTGRES_MCP_*` wiring gone; `pyproject.toml`/`uv.lock` drop `postgres-mcp`; `tests/test_tools_endpoint.py` and the `app/tools.py` docstring updated; feature 169's `acceptance/agent-postgres-mcp.feature` scenarios removed/inverted (C-16) |
| `xstockstrat-ui` | `src/lib/copilot.ts` `COPILOT_MCP_TOOL_COUNT` mirror 52 → 43, no drift |
| Platform lead | Deployment cleanup: `docker-compose.yml` agent block drops the postgres-mcp co-process; `.do/app*.yaml` drops any `POSTGRES_MCP_*` env; the connection-pool budget row in root CLAUDE.md is removed; the dead `xstockstrat_agent` provisioning block in `scripts/db-migrate.sh` is deleted (the role was never created — `POSTGRES_MCP_AGENT_PASSWORD`-gated `[skip]` path) |

## Next Action

`/sdd-review remove-agent-postgres-mcp impl-spec` — validate the implementation spec, then `/sdd-execute remove-agent-postgres-mcp`.
