# Feature: mcp-get-positions-tools

**Development Branch**: `feature/mcp-get-positions-tools`
**Created**: 2026-09-02
**Last Updated**: 2026-09-02


---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-02 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-02 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 warnings) |
| 2026-09-02 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, quick) and approved; recon.md + design.md written |
| 2026-09-02 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 8 steps |
| 2026-09-02 | `implementation-ready` → `in-progress` | /sdd-execute | Execution started |
| 2026-09-02 | `in-progress` → `code-completed` | /sdd-execute | All 8 steps done |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, risks
- [Design](design.md) — debated, user-approved architecture (2 rounds, quick)
- [Implementation Spec](implementation-spec.md) — 8 steps: client consolidation, tool registration, backward-compat update, tests (unit + parity + name-set), doc updates
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

Merge integration PR into `main-dev` when CI passes and reviewers approve.
