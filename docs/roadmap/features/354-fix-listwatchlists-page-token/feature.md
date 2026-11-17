# Feature: fix-listwatchlists-page-token

**Type**: bug
**Development Branch**: `ccr-fix-listwatchlists-page-token` (harness `ccr-*` branch off `main-dev`, used in place of `feature/fix-listwatchlists-page-token`)
**GitHub Issue**: none (Issues disabled) — defect report `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-16
**Last Updated**: 2026-11-17
**Committed to main**: dd41417dd5798a5133a4c963c60f556e79b499a5
**Launched date**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-11-16-portfolio-listwatchlists-page-token-skips-boundary-row-defect.md` |
| 2026-11-17 | `draft` → `design-approved` | /sdd-design | Design debated (5 rounds + 4 post-cap confirmation passes, full) and approved; recon.md + debate.md + design.md written; user C-14 sign-off recorded |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 2 steps (one Lands-with service+test unit; C-14 override logged in Deviation Log) |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute (sequential) | Steps 1+2 (Lands-with unit) started |
| 2026-11-17 | `in-progress` → `code-completed` | /sdd-execute (sequential) | Steps 1+2 done in one commit; unit + real-backend dbtest RED→GREEN; integration PR #1566 |

| 2026-11-17 | `code-completed` → `launched` | CI workflow | Promoted via PR #1573; committed dd41417dd5798a5133a4c963c60f556e79b499a5 |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier
- [Debate Register](debate.md) — D-1..D-23, R-1..R-13, O-1..O-16
- [Design](design.md) — approved approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`ListWatchlists` returns the look-ahead row's id as `next_page_token`, and the exclusive keyset filter then skips that row, so every page boundary silently drops one watchlist.

## Reviewers

_(Snapshot finalized by /sdd-spec on 2026-11-17 from docs/runbooks/reviewer-registry.md and the
per-step `**Reviewers**` lines. Re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-portfolio` owner | P&L calculation accuracy, position snapshot consistency, concurrent write safety |

---

## Next Action

Merge integration PR #1566 (merge train); after launch run the D-19 dev smoke (agent `list_watchlists` with a small `limit`).
