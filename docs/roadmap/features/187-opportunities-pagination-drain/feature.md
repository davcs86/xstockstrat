# Feature: opportunities-pagination-drain

**Development Branch**: `feature/opportunities-pagination-drain`
**Created**: 2026-09-11
**Last Updated**: 2026-09-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-11 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-09-11 | `draft` → `design-approved` | /sdd-design quick | Design approved — 3 user steers: page_size stays 50, server-side symbol grouping, manual Load More (no auto-drain) |
| 2026-09-11 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated — 10 steps across 3 services |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — 10 steps, 3 services
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The ListOpportunities RPC defaults to a 50-row page size and no consumer (UI or agent) consumes
subsequent pages, silently capping the surfaced queue at ~50 rows even when 150+ materialized
opportunities exist. This feature adds server-side symbol grouping (SQL window function) so page
boundaries respect symbol clusters, converts the UI to `useInfiniteQuery` with a manual "Load More"
button for progressive retrieval, and exposes `page_token`/`page_size` on the agent tool for MCP
caller pagination.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner (`xstockstrat-analysis`) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Service owner (`xstockstrat-ui`) | Analytics display accuracy, Connect-RPC call safety |
| Service owner (`xstockstrat-agent`) | MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity |

## Next Action

`/sdd-review opportunities-pagination-drain impl-spec` — then `/sdd-execute opportunities-pagination-drain`
