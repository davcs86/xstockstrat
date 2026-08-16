# Feature: fix-listorders-ambiguous-updated-at

**Type**: bug
**Lifecycle Status**: `code-completed`
**Development Branch**: `claude/commit-135-opportunities-strategies-0xjnxk`
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; bug captured directly via `/sdd-triage` (Track C) from `docs/reports/2026-08-16-trading-listorders-ambiguous-updated-at-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-16
**Last Updated**: 2026-08-16

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-08-16 | `draft` (unchanged) | /sdd-triage (boot correction) | Corrected **Development Branch** `feature/fix-listorders-ambiguous-updated-at` → `claude/commit-135-opportunities-strategies-0xjnxk` — session's harness assignment requires all work stay on the `claude/*` branch (same pattern as feature 135's own boot correction) |
| 2026-08-16 | `draft` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; recon.md + design.md written. User chose the single-site AS-alias rename over 3-site qualification, and 3 pgxmock tests over 1. |
| 2026-08-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 2 steps (service + test) |
| 2026-08-16 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started on `claude/commit-135-opportunities-strategies-0xjnxk`. Step 1 done: renamed intentLateralJoinSQL's updated_at → intent_updated_at, added dbQuerier seam. |
| 2026-08-16 | `in-progress` → `code-completed` | /sdd-execute | Step 2 done: 3 pgxmock regression tests, red-before-green confirmed against real pre/post-rename SQL. go vet + golangci-lint clean; full suite passes. Live-DB smoke test unavailable (no docker daemon) — go vet/query-shape fallback used per spec. Both steps complete. |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture (single-site AS-alias rename)
- [Implementation Spec](implementation-spec.md) — 2 steps (service + test)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`TradingRepo.ListOrders`/`GetOrder`/`ListSubmittedOrders` fail on every call against staging
Postgres with `column reference "updated_at" is ambiguous (SQLSTATE 42702)` and silently fall
back to an in-memory store, because the `intentLateralJoinSQL` LATERAL join (feature 101) exposes
a second unqualified `updated_at` column that the outer SELECT collides with.

## Reviewers

| Role | Focus |
|---|---|
| Service Owner (`xstockstrat-trading`) | Order execution correctness, broker API safety, fill detection, paper-only dev invariant, position limit enforcement |

## Next Action

Check `docs/roadmap/features/merge-order.md`, then open the final integration PR:
`feature-branch (claude/commit-135-opportunities-strategies-0xjnxk) → main-dev`
