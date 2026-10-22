# Feature: fix-portfolio-snapshot-surface

**Type**: bug
**Development Branch**: `feature/fix-portfolio-snapshot-surface`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md` (debt-radar D-12, D-24) |

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
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec fix-portfolio-snapshot-surface`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`StreamPortfolioUpdates` fans every user's snapshot out to every subscriber, and the gRPC path accepts a subscriber
with no user id. The producer is live per fill and the consumer is not wired yet (D-24, latent security).
`StartSnapshotWriter` has no callers, so `portfolio.snapshot.interval_minutes` is a dead key (D-12).

## Next Action

`/sdd-design fix-portfolio-snapshot-surface quick` — recommended design depth: quick (single service, SEV-2; escalate to full if design deletes the config key via a migration); see context.md
