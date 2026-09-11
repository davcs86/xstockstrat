# Feature: opportunities-pagination-drain

**Development Branch**: `feature/opportunities-pagination-drain`
**Created**: 2026-09-11
**Last Updated**: 2026-09-11

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-11 | `idea` → `draft` | /sdd-story | Product spec generated |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec <slug>`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The ListOpportunities RPC defaults to a 50-row page size and no consumer (UI or agent) drains
subsequent pages, silently capping the surfaced queue at ~50 rows even when 150+ materialized
opportunities exist. This feature reduces the default page size to 25 and implements auto-drain
pagination in the UI hook so all materialized rows are surfaced.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Service owner (`xstockstrat-analysis`) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Service owner (`xstockstrat-ui`) | Analytics display accuracy, Connect-RPC call safety |

## Next Action

`/sdd-review opportunities-pagination-drain product-spec` — AI review of product spec before running /sdd-spec
