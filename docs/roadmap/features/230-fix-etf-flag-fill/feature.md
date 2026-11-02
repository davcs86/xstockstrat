# Feature: fix-etf-flag-fill

**Type**: bug
**Development Branch**: `feature/fix-etf-flag-fill`
**GitHub Issue**: n/a (Issues disabled) — defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-15
**Last Updated**: 2026-11-02

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-15 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from defect report `docs/reports/2026-10-15-etf-flag-fill-never-labels-defect.md` |
| 2026-10-22 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 warnings, overlap WARN); scope narrowed to @AC-2/@AC-3, lands after 255 |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (3 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 7 steps; acceptance.feature amended (@AC-2 rewritten, @AC-3 split into @AC-3/@AC-5/@AC-6, @AC-4 and @AC-7 added) and product-spec FR-2 trace clause + FR-3 added per design.md |
| 2026-11-02 | `implementation-ready` (re-spec) | /sdd-execute | Steps 0–7 re-anchored on `cfd240af` after the `origin/main-dev` merge; pre-execution gate passes (255 landed). Operator decisions: Step 2 extends 255's classifier table, Step 4 folds `infoRecorder` into one level-aware recorder |
| 2026-11-02 | `implementation-ready` → `in-progress` | /sdd-execute | `sequential` mode (sdd-batch-execute); operator up-front confirmation given 2026-11-02 |
| 2026-11-02 | `in-progress` (Step 1 done) | /sdd-execute | Step 1 — exported `fmp.ErrorClass` (`fmp_client.go:348`) delegating to 255's `enrichmentClass`; RED `undefined: ErrorClass`, GREEN after export |
| 2026-11-02 | `in-progress` (Step 2 done) | /sdd-execute | Step 2 — `TestEnrichmentClassifier_StagesAndOther` now asserts `ErrorClass == class` and never empty on every row (AC-5); no new rows; RED `undefined: ErrorClass` (overlay), GREEN |
| 2026-11-02 | `in-progress` (Step 3 done) | /sdd-execute | Step 3 — ETF filler carries the enqueuing trace id (`etfFillItem`), `etfFillGate` reports a skip reason, and three rate-limited Info records (`skipped`/`failed` class-only/`unlabelled`) replace the silent return and raw-error Debug record; RED Step-4-style probe (no Info records) → GREEN |
| 2026-11-02 | `in-progress` (Step 4 done) | /sdd-execute | Step 4 — one level-aware `recordingLogHandler`/`installLogRecorder` (`infoRecorder` folded in, heartbeat test moved onto it); `@AC-3`–`@AC-7` ETF fill-visibility tests; RED on the pre-Step-3 tree (overlay: zero Info records) → GREEN under `-race` |
| 2026-11-02 | `in-progress` (Step 5 done) | /sdd-execute | Step 5 — `TestEtfFlagFiller_LabelledAfterGateReopens_AC2`: a symbol skipped by a closed budget gate (200/250) is re-enqueued, fetched and labelled once the gate reopens (5/250) (`@AC-2`); P-06 waiver (regression guard), mutation RED (closed-gate skip negative-cached → `source calls = 0, want 1`) → GREEN under `-race` |
| 2026-11-02 | `in-progress` (Step 6 done) | /sdd-execute | Step 6 — marketdata `CLAUDE.md` `GetEtfFlags` paragraph: `etfFlagLogEvery` 1 minute added to the fixed invariants, plus one bullet on the three Info fill records (`skipped` reasons, `failed` class-only, `unlabelled`), their rate limits and `trace_id`; `not_wired` left undocumented. TDD N/A (docs) |
| 2026-11-02 | `in-progress` (Step 7 done) | /sdd-execute | Step 7 — C-14 read-only consumer check: feature diff vs `origin/main-dev` touches no analysis/ui/agent/proto file; `_fundamentals_gap_labels` (`servicer.py:2042`) still maps `is_etf` true → `FUNDAMENTALS_GAP_ETF` (`:2057-2058`); analysis `ruff check`/`format --check` clean. TDD N/A (read-only). All 7 steps done |

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — grounded codebase dossier (Phase 0)
- [Design](design.md) — approved design: chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec (2026-10-22).

| Role | Focus | Steps |
|---|---|---|
| xstockstrat-marketdata owner | OHLCV ingestion integrity, TimescaleDB hypertable partitioning, Alpaca feed idempotency | 1, 2, 3, 4, 5 |
| xstockstrat-analysis owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 7 (read-only) |

---

## Summary

The background ETF-flag fill in xstockstrat-marketdata never labels SCHD on staging, so feature 215's
`fundamentals_gap` stays `FUNDAMENTALS_GAP_UNSPECIFIED`. Nothing at Info level shows why. The prime
suspect, the FMP budget boot seed counting non-FMP fundamentals rows, is fixed by
`255-fix-marketdata-fundamentals-cache`; 230 (narrowed 2026-10-22) lands after 255 and adds the
later-call labelling guard plus rate-limited Info-level fill visibility.

## Next Action

All 7 steps done 2026-11-02. Next: flip `status.md` to `code-completed`, check `merge-order.md` (after 255), then open the integration PR (`/sdd-execute fix-etf-flag-fill sequential` final phase; PR body carries the root CLAUDE.md Teardown record for the Step 6 marketdata `CLAUDE.md` edit)
