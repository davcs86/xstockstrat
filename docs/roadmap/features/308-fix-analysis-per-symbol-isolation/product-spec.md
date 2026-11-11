# Product Spec: fix-analysis-per-symbol-isolation

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md`, `docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md`, `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### One candidate's non-RpcError aborts the whole per-user opportunities compute (SEV-2)

- **Observed**: `_compute_opportunities` gathers `_row_for` over candidates with no `return_exceptions`;
  `_row_for` catches only `grpc.RpcError`. A `FormulaExecutionError` (or any other exception) from one
  candidate aborts the user's whole compute; the background recompute ends `compute_failed` and the daily
  refresh skips the user, leaving the queue stale or empty.
- **Expected**: the failing candidate degrades to its own row (`"unavailable"` provenance or a distinct
  formula-fault marker); the remaining candidates are materialized.
- Report: [`docs/reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md`](../../../reports/2026-10-21-analysis-opportunities-row-gather-no-per-symbol-isolation-defect.md)

### EvaluateReadiness fails entirely when one symbol's readiness compute raises (SEV-2)

- **Observed**: `EvaluateReadiness` gathers `_readiness_for` with no per-symbol guard; any exception
  from one symbol's SLOW path fails the RPC as gRPC UNKNOWN, and the healthy symbols' SLOW rows are never
  persisted (`upsert_many` runs after the gather).
- **Expected**: the failing symbol degrades to its own empty/unavailable `SymbolReadiness`; the rest are
  returned and cached.
- Report: [`docs/reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md`](../../../reports/2026-10-21-analysis-readiness-gather-no-per-symbol-isolation-defect.md)

### A genuine indicators outage loses whole readiness batches and heal rows (SEV-3)

- **Observed**: an indicators `UNAVAILABLE` / `DEADLINE_EXCEEDED` from `ExecuteFormula` escapes
  `compute_readiness_row` and is caught only outside the per-symbol loop: `_kick_readiness_refresh`
  discards the whole batch (rows stay PENDING, re-kicked every poll), the readiness materializer loses the
  owner's remaining symbols, and the opportunity 300 s heal loses all `heal_rows`. Separately, the
  symbol-wide `fetch_failed` set filled concurrently can mark a sibling candidate `unavailable` by
  completion order.
- **Expected**: a single failing symbol/formula degrades only that symbol's readiness (with a diagnostic,
  as `GetIndicatorSeries` already does); a transient outage does not discard the batch, owner pass, or
  heal rows.
- Report: [`docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md`](../../../reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md)

## Reproduction Steps

1. Opportunities: make `evaluate_conditions_traced` raise `FormulaExecutionError` (or `ZeroDivisionError`)
   for one candidate; run `_compute_opportunities` with it plus healthy candidates → the compute raises, no
   rows are written.
2. Readiness RPC: make `compute_readiness_row` raise `ZeroDivisionError` for one symbol; call
   `EvaluateReadiness` with it plus healthy symbols → UNKNOWN, no readiness returned.
3. Batch/heal: make indicators `ExecuteFormula` return `UNAVAILABLE` for one strategy component; trigger
   `GetWatchlistReadiness` (kick) or the materializer tick → no row for any of the user's symbols is
   written; WARN "readiness refresh kick failed" / "readiness materializer failed for owner".

All three are code-read findings; none was reproduced.

## Root Cause Hypothesis

Isolation scope: each per-symbol fan-out's only exception handler sits outside the per-symbol unit (or
catches only `grpc.RpcError`). Feature 245 isolated `ScreenerEngine.screen()` per symbol; these siblings
were left as is. Current sites (main-dev @ 0fecb24d, `services/xstockstrat-analysis/`):

- `app/handlers/servicer.py:5916` — opportunities gather; `:5742` `_row_for`; `:5824` the
  `except grpc.RpcError`; `:5829` the feature-185 "formula bug, NOT a data outage … left to propagate" comment.
- `app/handlers/servicer.py:4103` — `EvaluateReadiness` gather; `:4031` `_readiness_for` (unguarded).
- `app/handlers/servicer.py:4261` `_kick_readiness_refresh` (outer catch `:4356-4357`, `upsert_many`
  after the loop); `:6085` `_materialize_readiness_for_owner` (per-owner catch `:6229`); `:4969`
  `_retry_unavailable_symbols` (caught at `:4962`).
- `app/services/readiness.py:38` `compute_readiness_row` — evaluation not wrapped (only the bars fetch is).
- `fetch_failed` symbol-wide set: `servicer.py:5806,5833,5876-5881` (feature 215 already guards the
  skip-row case only).

## Affected Services

- xstockstrat-analysis (only)

## Fix Scope

- No proto changes anticipated — all three reports degrade within existing response shapes (`"unavailable"`
  provenance, empty `SymbolReadiness`).
- No database migrations anticipated — rows land in the existing `readiness_cache` / opportunities tables.
- No config key changes anticipated — no report names a threshold or toggle.

## Open Questions

1. Does the feature-185 abort contract (`FormulaExecutionError` deliberately propagates out of `_row_for`)
   stand, or is it aligned with the feature-245 screener (isolate `Exception` per symbol)? (Report 1: triage
   must decide.)
2. If isolated, does a formula fault reuse the `"unavailable"` provenance marker or get a distinct
   formula-fault marker? (Report 1.)
3. Is the `fetch_failed` cross-candidate completion-order race (report 3, "Separately") in this feature's
   scope or split out?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `ScreenerEngine.screen()` — already isolated by feature 245.
- The admin/owner formula refusal path — fixed by feature 289.
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
