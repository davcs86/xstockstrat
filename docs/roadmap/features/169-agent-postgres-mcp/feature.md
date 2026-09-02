# Feature: agent-postgres-mcp

**Development Branch**: `feature/agent-postgres-mcp`
**Created**: 2026-09-02
**Last Updated**: 2026-09-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-02 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-02 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning: @AC-5 qualitative Then clause) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec agent-postgres-mcp`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Integrates the crystaldba `postgres-mcp` server into the `xstockstrat-agent` container as a co-process managed by **supervisord**, exposing its read-only database-analysis tools (EXPLAIN, health checks, index tuning, schema introspection) through the existing OAuth 2.1–protected MCP endpoint — **admin-scoped callers only**.

## Reviewers

_(Snapshot from reviewer-registry.md at /sdd-story time. Finalized at /sdd-spec time.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture, new process in container, supervisord vs. one-process-per-container norm |
| Security | Admin-gate enforcement (`x-access-scope` bit), read-only DB role credential wiring, no secret values in tool output |
| DBA | Dedicated read-only Postgres role, connection-pool budget impact (~22 shared connections), TimescaleDB compatibility |
| `xstockstrat-agent` owner | MCP tool contract stability, OAuth 2.1 edge correctness, admin scope forwarding pattern, `mcp-tools.md` parity |

## Next Action

`` `/sdd-spec agent-postgres-mcp` `` — generate implementation spec
