# Feature: fix-fundsignal-emit-accounting

**Type**: bug
**Development Branch**: `feature/fix-fundsignal-emit-accounting`
**GitHub Issue**: none (Issues disabled). Defect report: `docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21
**Last Updated**: 2026-10-29

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-10-21 | `bug-reported` → `draft` | /sdd-triage | Product spec pre-populated from `docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md` (debt-radar D-43, D-57) |
| 2026-10-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (7 warnings; overlap WARN) |
| 2026-10-22 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md + design.md written |
| 2026-10-22 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 9 steps |
| 2026-10-29 | `implementation-ready` (unchanged) | /sdd-execute (re-spec) | Steps 1-9 re-aligned to `main-dev` after the 246 merge: line drift in 1, 2, 4, 6; `_score` tuple return in 3, 5; Step 9 merges with 246's Idempotency text; Steps 7-8 unchanged |
| 2026-10-29 | `implementation-ready` → `in-progress` | /sdd-execute sequential (sdd-batch-execute) | Execution started; up-front plan confirmed by the operator's standing authorization (2026-10-28/29) |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 1 done: RED tests for @AC-4/@AC-6 (`TestFailedChunk`) and the 4-tuple `_paced_fetch` unpack |

---

## Reviewers

Snapshot from `docs/runbooks/reviewer-registry.md` at /sdd-spec time (2026-10-22), with per-step assignments.

| Reviewer | Focus | Steps |
|---|---|---|
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, no look-ahead bias | 1, 2, 3, 4, 5, 6 (test/service); 7, 8 (proto, proto-gen) |
| Proto Reviewer | Field number uniqueness, no breaking change, `buf lint` / `buf breaking` pass | 7 (proto), 8 (proto-gen, inherited) |

There are no steps for the `xstockstrat-ingest` owner, because ingest stays read-only: /sdd-spec re-verified the
dedup claim at `servicer.py:1016-1066`. There are no steps for the DBA either, because there is no migration.

---

## Artifacts

- [Product Spec](product-spec.md) — bug description and fix scope
- [Acceptance Scenarios](acceptance.feature) — regression scenario(s) (`@AC-*`, C-15)
- [Recon](recon.md) — Phase 0 codebase dossier
- [Design](design.md) — approved design (2 rounds, full)
- [Implementation Spec](implementation-spec.md) — 9 steps
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

The fundamentals producer claims the day's `fundsignal_emitted` row before emitting, so a failed `IngestSignal`
blocks that symbol for the rest of the day and is still counted as emitted. A failed `GetFundamentalsMulti` chunk's
symbols are neither fetched nor deferred, and the run still reports `completed`.

## Next Action

`/sdd-execute fix-fundsignal-emit-accounting sequential` — Step 1 (RED test)
