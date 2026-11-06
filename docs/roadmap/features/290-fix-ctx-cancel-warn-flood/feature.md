# Feature: fix-ctx-cancel-warn-flood

**Type**: bug
**Development Branch**: `feature/fix-ctx-cancel-warn-flood`
**Defect report**: `docs/reports/2026-11-04-portfolio-marketdata-warn-flood-after-ctx-cancel-defect.md` (Issues disabled; no GitHub issue)
**Severity**: SEV-3
**Created**: 2026-11-04
**Last Updated**: 2026-11-06

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-11-04 | `bug-reported` -> `draft` | /sdd-triage | Product spec pre-populated from defect report |
| 2026-11-04 | `draft` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written; marketdata variant: detach, post-departure bound + 1 writer (/sdd-review skipped on operator instruction) |
| 2026-11-04 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps |
| 2026-11-05 | `implementation-ready` (re-spec, no status change) | /sdd-execute (sdd-batch-execute) | Steps 1-5 re-specced to the current codebase: portfolio anchors +6, fakeLedger :267, false pgxmock precedent removed, marketdata test append point = true EOF, PORTFOLIO-15 at :48 |
| 2026-11-05 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started; operator approved the up-front plan (sequential mode-entry confirmation) |
| 2026-11-05 | `in-progress` (re-spec, no status change) | /sdd-execute (sdd-batch-execute) | Step 5 re-specced (advisory): PORTFOLIO-10 stale anchors `shouldReconcileSyncDeletions` (~L1074 → :1381) and `processAccountDeregistered` (~L1059 → :1338) added to the re-stamp list |
| 2026-11-05 | `in-progress` (Step 1 done, no status change) | /sdd-execute sequential (sdd-batch-execute) | Step 1: `processPositionSync` returns `ctx.Err()` once its context is done (checks before each write and in each write's error branch) |
| 2026-11-05 | `in-progress` (Step 2 done, no status change) | /sdd-execute sequential (sdd-batch-execute) | Step 2: `portfolio_sync_cancel_test.go` adds AC-1/2/3/10 regression tests (red on the pre-Step-1 tree) and AC-4/5 characterization guards |
| 2026-11-06 | `in-progress` (Step 3 done, no status change) | /sdd-execute sequential (sdd-batch-execute) | Step 3: the `fetchAndCacheBars` cache write now runs on a detached context (`cacheLiveBars`), limited by `barsCacheWriteGrace` (5 s) only after the client leaves, with one departed writer at a time. The operator waived the staging `InsertBars` timing gate (Option C) |
| 2026-11-06 | `in-progress` (Step 4 done, no status change) | /sdd-execute sequential (sdd-batch-execute) | Step 4: `marketdata_service_test.go` adds the `barsCancelSource` and `recordingBarsStore` fakes and the six `TestFetchAndCacheBars_AC{6,7,8,9,11,12}_*` tests (red on the pre-Step-3 tree) |
| 2026-11-06 | `in-progress` → `code-completed` | /sdd-execute sequential (sdd-batch-execute) | Step 5: the marketdata `GetBars` bullet, MARKETDATA-3, the portfolio `account.positions.synced` row and PORTFOLIO-3 now describe the detached cache write and the cancel-stop; anchors that Steps 1/3 shifted were re-stamped. The Teardown was done by hand because the context-forge refresh skill was unavailable. All 5 steps done |

---

## Artifacts

- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Implementation Spec](implementation-spec.md) — 5 numbered steps, evidence-cited
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

| Role | Focus | Steps |
|---|---|---|
| Service owner `xstockstrat-portfolio` | P&L calculation accuracy, position snapshot consistency, concurrent write safety | 1, 2 |
| Service owner `xstockstrat-marketdata` | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 3, 4 |

---

## Summary

On a canceled context portfolio's `ConsumePositionSyncs` and marketdata's `GetBars` cache-insert path keep iterating and log one WARN per item (3.3k + 557 lines in 7 days).

## Next Action

Integration PR `feature/fix-ctx-cancel-warn-flood` → `main-dev`. Check `merge-order.md` first: merge 290 before 291 and 294. The PR body must record that the context-forge refresh skill was unavailable and describe the manual reconciliation. Promote `acceptance.feature` into the durable suites (C-16) in that PR.
