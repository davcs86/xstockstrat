# Feature: ui-consolidation-nextjs

**Lifecycle Status**: `launched`
**Committed to main**: edf803cb8942cee14abc604d1ed95c11b79d8445
**Launched date**: 2026-06-04
**Development Branch**: `feature/ui-consolidation-nextjs`
**Created**: 2026-05-29
**Last Updated**: 2026-06-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-05-29 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-05-29 | `draft` → `spec-ready` | /sdd-review | Product spec approved (1 advisory warning) |
| 2026-05-30 | `spec-ready` → `draft` | /sdd-story | Product spec regenerated fresh; previously-resolved questions re-opened for review |
| 2026-06-01 | `draft` → `spec-ready` | /sdd-review | Product spec approved. All 5 OQs resolved: `xstockstrat-ui` name, single-domain DO routing, keep pg as-is, 041 already launched (no dep), 044 before 045. |
| 2026-06-01 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-06-01 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — xstockstrat-ui service created, build passes |
| 2026-06-02 | `in-progress` → `code-completed` | /sdd-execute | All 9 steps done — service consolidated, e2e suite passes |

| 2026-06-04 | `code-completed` → `launched` | CI workflow | Promoted via PR #523; committed edf803cb8942cee14abc604d1ed95c11b79d8445 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Consolidate the three Next.js frontend services (trader, insights, config-ui) into a single Next.js service and remove the nginx reverse proxy, reducing infrastructure costs from 4 containers to 1 while preserving all existing basePaths, auth, observability, and agent SSE proxying.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Platform Lead | Cross-service architecture, port assignments, service registry consistency, inter-service dependency graph correctness |
| xstockstrat-trader owner | Trading UI correctness, Connect-RPC call safety, no direct DB access from frontend |
| xstockstrat-insights owner | Analytics display accuracy, SSE polling resilience, read-only access pattern |
| xstockstrat-config-ui owner | Config mutation safety, environment scope correctness, no secret values rendered in UI |

## Next Action

`/sdd-execute ui-consolidation-nextjs next` — all steps complete; open final integration PR into `main-dev`
