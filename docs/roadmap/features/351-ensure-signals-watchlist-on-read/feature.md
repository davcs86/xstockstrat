# Feature: ensure-signals-watchlist-on-read

**Development Branch**: `feature/ensure-signals-watchlist-on-read`
**Created**: 2026-11-16
**Last Updated**: 2026-11-16
**Committed to main**: dd41417dd5798a5133a4c963c60f556e79b499a5
**Launched date**: 2026-11-17

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-16 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-11-16 | `draft` → `spec-ready` | /sdd-review | Product spec approved after 2 rounds (round 1 FAIL: unresolved Open Questions; round 2 PASS WITH WARNINGS, all fixed; 2 author assumptions carried to the design gate) |
| 2026-11-16 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full; escalated from quick at the post-Recon gate) and approved; recon.md + debate.md + design.md written; token bug split to separate defect sessions, cap accepted at 49, fail-open confirmed |
| 2026-11-17 | `implementation-ready` → `in-progress` | /sdd-execute (sequential) | Step 1 committed on `ccr-1305a9de-7x1t7v` (no per-step PR; integration PR is #1561) |
| 2026-11-17 | `in-progress` → `code-completed` | /sdd-execute (sequential) | Steps 1-6 done; Step 5 landing gate passed once 354 (#1566) merged to main-dev; scenarios promoted; merge-order row resolved; integration PR #1561 |
| 2026-11-17 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 6 steps |

| 2026-11-17 | `code-completed` → `launched` | CI workflow | Promoted via PR #1573; committed dd41417dd5798a5133a4c963c60f556e79b499a5 |
---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon](recon.md) — grounded codebase dossier + existing business rules (C-16)
- [Debate Register](debate.md) — settled decisions D-1..D-12, locked rejections R-1..R-6, objections O-1..O-24
- [Design](design.md) — approved architecture, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 6 numbered steps with evidence, TDD gates and `@AC-*` coverage
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The per-user system-managed "Signals" watchlist (feature 127) exists only after an agent `ingest_signal(direction="watchlist")` side effect, so users who never ingested one (Homelab staging) have none. `ListWatchlists` will idempotently ensure the caller's system list so every user sees it.

## Reviewers

| Role | Review Focus |
|---|---|
| Service owner — `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety |

## Next Action

`/sdd-review ensure-signals-watchlist-on-read impl-spec` — validate implementation spec, then `/sdd-execute ensure-signals-watchlist-on-read`. Steps 1-4 can run before the `ListByUser` token fix lands; Step 5 (landing gate) fails until it is on `origin/main-dev`, and Step 6 waits for Step 5.
