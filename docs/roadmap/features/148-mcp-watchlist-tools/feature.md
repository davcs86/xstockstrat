# Feature: mcp-watchlist-tools

**Development Branch**: `feature/mcp-watchlist-tools`
**Created**: 2026-08-21
**Last Updated**: 2026-08-21
**Committed to main**: bfa1995a3e5d36758f96ac8ef1ff97a31c68ef00
**Launched date**: 2026-08-21
**Archived**: 2026-08-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-21 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-21 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. Note: /sdd-review product-spec skipped (harness single-branch flow); update-contract fork user-approved |
| 2026-08-21 | `design-approved` → `code-completed` | implementation | 4 agent tools + client wrappers + tests; 266 pass @78% cov, ruff clean, inventory synced to 28 tools |

| 2026-08-21 | `code-completed` → `launched` | CI workflow | Promoted via PR #1001; committed bfa1995a3e5d36758f96ac8ef1ff97a31c68ef00 |
| 2026-08-21 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(0)/fails(0); promoted @AC-1..@AC-9 to agent suite; pruned 3 specs |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase facts (Phase 0)
- [Design](design.md) — debated, user-approved architecture (Phase 1)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec mcp-watchlist-tools`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Expose the existing `xstockstrat-portfolio` watchlist RPCs (feature 058/097/127) as new
`xstockstrat-agent` MCP tools so an AI agent can list, read, create/update/delete watchlists and
add/remove their symbols on behalf of the calling user.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` owner | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all inventory surfaces; ownership `x-user-id` forwarded (not admin scope); no secret values in tool output |
| `xstockstrat-portfolio` owner | Watchlist ownership/consistency of the wrapped RPCs (no contract change — advisory) |

## Next Action

Open the PR to `main-dev`; after merge + promote, flip to `launched`.
