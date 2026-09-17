# Feature: sysadmin-db-write-role

**Development Branch**: `feature/sysadmin-db-write-role`
**Created**: 2026-09-17
**Last Updated**: 2026-09-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-17 | `idea` → `draft` | /sdd-story | Product spec generated (closes security audit H-5 / DT-2) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec sysadmin-db-write-role`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A dedicated `sysadmin` role — the **sole** privilege permitted to execute write/destructive SQL
through the MCP agent's `db_execute_sql` tool, and grantable **only** via the server-side
`scripts/manage-users.py` (never through any consumer surface) — so a prompt-injected or compromised
admin session cannot perform arbitrary cross-schema DB writes. Closes security-audit finding **H-5**
(`docs/reports/2026-09-16-trading-system-security-audit.md`, DT-2) while preserving feature 169's
FR-2 write capability behind a privilege no consumer can obtain.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | Auth-scope correctness; a new privilege bit must not be consumer-assignable; no blanket `x-access-scope` forwarding (fails.md 2026-08-05) |
| `xstockstrat-agent` | MCP tool contract stability (`db_execute_sql`), admin/scope forwarding, `docs/runbooks/mcp-tools.md` parity + tool-count surfaces |
| `xstockstrat-identity` | JWT role→claim mapping, role scoping, closed proto `Role` set integrity |
| `xstockstrat-ui` | Access-scope bit mirror correctness (`src/lib/auth.ts`), no privilege drift between mirrors |

## Next Action

`/sdd-review sysadmin-db-write-role product-spec` — AI review of product spec before running /sdd-spec
