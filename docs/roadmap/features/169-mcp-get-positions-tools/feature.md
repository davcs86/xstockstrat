# Feature: mcp-get-positions-tools

**Development Branch**: `feature/mcp-get-positions-tools`
**Created**: 2026-09-02
**Last Updated**: 2026-09-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-02 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec mcp-get-positions-tools`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Add two standalone MCP tools — `get_positions` and `get_positions_by_account_id` — to expose portfolio position data through the agent. Both tools are user-bound (forwarding `x-user-id` only, no admin scope), so every caller — including admins — sees only their own positions.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner: `xstockstrat-agent` | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; no secret values in tool output |
| Service owner: `xstockstrat-portfolio` | Position snapshot consistency, concurrent write safety |

## Next Action

`/sdd-review mcp-get-positions-tools product-spec` — AI review of product spec before running /sdd-spec
