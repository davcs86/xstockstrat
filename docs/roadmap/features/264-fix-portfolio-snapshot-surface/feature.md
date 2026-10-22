# Feature: fix-portfolio-snapshot-surface

**Type**: bug
**Development Branch**: `feature/fix-portfolio-snapshot-surface`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-22

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md` (debt-radar D-12, D-24) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (5 warnings; overlap WARN only) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Operator sign-off on @AC-4 deletion and @AC-5 change (branch b, migration 034) |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-triage time (2026-10-21). `/sdd-spec` overwrites it with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-portfolio` owner | Position snapshot consistency, per-user stream isolation, pool-budget impact of a periodic writer | All steps |
| Security | Cross-tenant isolation of `StreamPortfolioUpdates` (auth scope: a subscriber sees only its own `x-user-id`) | D-24 steps |
| `xstockstrat-config` owner | Only if design deletes `portfolio.snapshot.interval_minutes` (config seed migration + governance log) | Conditional |
| DBA | Only if design deletes the key via a new config migration | Conditional |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — approved design: owner-scoped fail-closed fan-out (D-24), retire `portfolio.snapshot.interval_minutes` via config migration 034 (D-12)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-portfolio-snapshot-surface`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`StreamPortfolioUpdates` fans every user's snapshot out to every subscriber, and the gRPC path accepts a subscriber
with no user id. The producer is live per fill and the consumer is not wired yet (D-24, latent security).
`StartSnapshotWriter` has no callers, so `portfolio.snapshot.interval_minutes` is a dead key (D-12).

## Next Action

`/sdd-spec fix-portfolio-snapshot-surface` — generate implementation spec from the approved design
