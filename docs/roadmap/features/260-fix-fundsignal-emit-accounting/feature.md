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
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 2 done: `_paced_fetch` returns a `failed` bucket; a run with a failed chunk ends `partial` with one combined warning |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute (re-spec, sdd-batch-execute) | `origin/main-dev` merged into the branch (clean; ledger-guard clean). Steps 3-6 re-aligned to the current codebase: `fundsignal_loop.py` and test-harness line drift only (+3..+8 in the loop, about +52 in tests); no change to scope, predicates or SQL |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 3 done: RED tests for @AC-1/2/3/5/7, the stateful `_EmittedTable` fake (`TestEmitAccounting`) and the `real_pg` claim/confirm/release file |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 4 done: an unconfirmed emit releases its NULL claim (`_release_claim`), the confirm is scoped by `run_id` and `signal_id IS NULL`, and only accepted signals are counted |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 5 done: RED tests for @AC-8/9 and the `reference_scores` cuts, plus the @AC-10 force PRESERVE pin (`TestRetryStability`, `_FixedClock`) |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 6 done: direction cuts include the day's stored scores (`_already_emitted` returns `symbol → score`, `_map_directions(reference_scores=…)`), and `valid_until` is anchored to the run date at midnight UTC except under `force`, which stays now-anchored |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 7 done: the `FundamentalsScanSummary.status` comment lists `"partial"` (comment only, no wire change; `buf lint`/`buf breaking` clean) |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 8 done: stubs regenerated with `./scripts/buf-gen.sh`; the Go and TS stubs plus the compiled `.d.ts` files carry the `"partial"` status comment (5 files, comment lines only) |
| 2026-10-29 | `in-progress` (unchanged) | /sdd-execute sequential | Step 9 done: analysis `CLAUDE.md` documents the `partial` status and the claim/release, accepted-only count, date-anchored `valid_until` and day-wide direction-cut rules; the MCP runbook lists `"partial"`; merge-order row confirmed |
| 2026-10-29 | `code-completed` | /sdd-execute sequential | All 9 steps done |

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

Merge `origin/main-dev` into `feature/fix-fundsignal-emit-accounting` (Step 7 deviation), then open the integration PR (`/sdd-execute fix-fundsignal-emit-accounting sequential` §5.6); the PR body records the manual teardown reconciliation (Step 9 deviation).
