# Feature: fix-opportunities-bars-fetch-oom

**Type**: bug
**Development Branch**: `claude/commit-135-opportunities-strategies-0xjnxk`
**GitHub Issue**: n/a — GitHub Issues are disabled on `davcs86/xstockstrat`; bug captured directly via `/sdd-triage` (Track C) from `docs/reports/2026-08-16-analysis-opportunities-bars-fetch-shared-memory-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-16
**Last Updated**: 2026-08-16
**Committed to main**: 6cd5572193b09a153c24e4cb90e3b65708846981
**Launched date**: 2026-08-19
**Archived**: 2026-08-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-16 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-08-16 | `draft` (unchanged) | /sdd-triage (boot correction) | Corrected **Development Branch** `feature/fix-opportunities-bars-fetch-oom` → `claude/commit-135-opportunities-strategies-0xjnxk` — session's harness assignment requires all work stay on the `claude/*` branch (same pattern as feature 135's own boot correction) |
| 2026-08-16 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written. Chosen: per-symbol bars dedup + a process-lifetime semaphore (default 2) bounding cross-user concurrency. Unit-level test proof accepted as sufficient (no staging load-test gate). |
| 2026-08-16 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 3 steps (service, test, config). |
| 2026-08-16 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential execution started on `claude/commit-135-opportunities-strategies-0xjnxk`. Step 1 done: bars_by_symbol dedup dict + self._bars_fetch_sem semaphore. Step 2 done: 3 tests, red-before-green confirmed. One deviation: read-side pagination (_DEFAULT_OPP_PAGE_SIZE=50, unrelated pre-existing behavior) required page_size=300 in the scale test. |
| 2026-08-16 | `in-progress` → `code-completed` | /sdd-execute | Step 3 done: analysis.opportunity.max_concurrent_bars_fetches registered in CLAUDE.md + config-governance.md. /context-scrubber unavailable this session (recorded, not skipped silently). ruff clean; full suite 522 passed, 83.5% coverage. All 3 steps complete. |

| 2026-08-19 | `code-completed` → `launched` | CI workflow | Promoted via PR #985; committed 6cd5572193b09a153c24e4cb90e3b65708846981 |
| 2026-08-26 | `launched` | /sdd-archiver | Archived: synthesis → context.md + Ledger insights(3)/fails(2); no scenarios (no acceptance.feature); pruned 4 specs |
---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture (per-symbol dedup + cross-request semaphore)
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

`_compute_opportunities`'s per-candidate bars-fetch call to `xstockstrat-marketdata` intermittently
fails with Postgres `out of shared memory (SQLSTATE 53200)`, skipping affected symbols for that
cycle's opportunity scoring/readiness trace. The per-cycle candidate set was structurally widened by
feature 131 (live-strategy fan-out, up to 5 extra candidates/symbol) and feature 132 (a
budget-exempt `muted_only` bucket), plausibly pushing an already-borderline bars query over a
lock-table/shared-memory threshold.

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at `/sdd-spec` time (2026-08-16). Stable until
`/sdd-spec` re-runs.

| Role | Scope | Review Criteria |
|---|---|---|
| Service Owner (`xstockstrat-analysis`) | Steps 1 (service), 2 (test), 3 (config) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| Config team | Step 3 (config) | New config key sign-off per root `CLAUDE.md` § Approval Flow ("New config key: owner + config team") — stricter than the config-rollout runbook's own service-owner-only summary; see design.md Open Risk 3 |

## Next Action

Check `docs/roadmap/features/merge-order.md`, then open the final integration PR:
`claude/commit-135-opportunities-strategies-0xjnxk → main-dev`
