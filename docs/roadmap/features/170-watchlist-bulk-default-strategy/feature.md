# Feature: watchlist-bulk-default-strategy

**Development Branch**: `feature/watchlist-bulk-default-strategy`
**Created**: 2026-09-03
**Last Updated**: 2026-09-03

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-03 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-03 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 warning, reclassified; overlap CLEAN) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec watchlist-bulk-default-strategy`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Extend the Insights watchlist experience with multi-select **bulk operations** (bulk-remove symbols
and bulk-assign one strategy across the selection) and a new watchlist-level **default strategy**
setting that binds newly-added, otherwise-unbound symbols at add time — surfaced in both the Insights
UI and the agent MCP tools, backed by an additive `portfolio` proto/DB change.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, additive-only (no breaking change), `buf breaking` green |
| `xstockstrat-portfolio` (service owner) | Concurrent write safety, ownership scoping on the new bulk-rebind + default-strategy writes |
| DBA | Migration 015 numbering, up+down pair, additive column default, index correctness |
| `xstockstrat-ui` (service owner) | Bulk-select state correctness across watchlist switch, Connect-RPC call safety, no partial-write UI states |
| `xstockstrat-agent` (service owner) | MCP tool contract stability + `docs/runbooks/mcp-tools.md` parity for `manage_watchlist` / `manage_watchlist_symbols` |

## Next Action

`/sdd-design watchlist-bulk-default-strategy quick` — ground the design (recon + one adversarial round) before /sdd-spec
