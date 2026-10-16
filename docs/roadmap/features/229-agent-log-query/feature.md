# Feature: agent-log-query

**Development Branch**: `feature/agent-log-query`
**Created**: 2026-10-16
**Last Updated**: 2026-10-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-16 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec agent-log-query`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

A read-only `query_logs` MCP tool on `xstockstrat-agent` lets a caller holding the new dedicated
`log_reader` role read redacted app-service and database-host logs for the agent's own environment
from Grafana Cloud Loki, so incidents can be diagnosed from a Claude.ai conversation.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity; all six tool-count surfaces in sync; no secret values in tool output or the unauthenticated `GET /api/tools` catalog |
| `xstockstrat-identity` owner | JWT claims minimal; role → claim mapping correct; unknown-role handling |
| `xstockstrat-config` owner | `agent.logs.*` key naming and env scoping; Loki token as an `is_secret` row, redacted at every read edge |
| `xstockstrat-ui` owner | `rolesToAccessScope` parity with the agent's `scopes.py`; no privilege leak into copilot calls |
| `xstockstrat-ledger` owner | Append-only audit events for log reads |
| Proto Reviewer | Additive `Role` enum value — field-number uniqueness, `buf breaking` passes |
| Security | New credential wiring (Loki read token) per config-governance Rule 6; least-privilege role; redaction completeness |

## Next Action

`/sdd-review agent-log-query product-spec` — AI review of product spec before running /sdd-spec
