# Product Spec: fix-fundsignal-emit-accounting

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-fundsignal-emit-accounting-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-43.** `FundamentalsSignalLoop.run_once` inserts the `analysis.fundsignal_emitted` claim row before calling
  `_emit_signal` (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:242-256`). On an `IngestSignal`
  failure other than `NOT_FOUND`, `_emit_signal` logs and returns `None` (`:541-548`). The row stays with `signal_id`
  NULL and `emitted += 1` still runs (`:269`). Every non-`force` rerun that day skips the symbol (`:255-256`), and
  `signals_emitted` over-reports. A `_SystemWriteRejected` abort (`:270-278`) leaves the current symbol's claim row.
- **D-57.** `_paced_fetch` logs a failed `GetFundamentalsMulti` chunk and still counts the call (`:394-403`). Those
  symbols are not in `fetched` or `deferred` (`deferred = symbols[i:]`, `:406`), and the run ends `"completed"`
  (`:280`).

**Expected.** A symbol whose emit failed is retryable the same day, and `signals_emitted` counts only accepted
signals. A failed chunk's symbols are reported as deferred or failed, and the run status reflects it. No orphan
claim survives a cycle abort.

**Who is affected.** Anyone who consumes fundamentals signals: live strategies that are signal-eligible, the
opportunity queue, and the agent `run_fundamentals_scan` / `list_opportunities` tools. On a day with a transient ingest
or marketdata error they silently get fewer signals, and the run record says the run succeeded.

## Functional Requirements

- **FR-1.** A symbol whose `IngestSignal` call failed (any error other than the `NOT_FOUND` system-write rejection)
  leaves no row that blocks it, so the next non-`force` run on the same day calls `IngestSignal` for it again.
- **FR-2.** `signals_emitted` on the finished (or aborted) run counts only signals that `IngestSignal` accepted,
  that is calls that returned a `signal_id`.
- **FR-3.** A cycle aborted by `_SystemWriteRejected` leaves no `analysis.fundsignal_emitted` row without a
  `signal_id` for the symbol it was processing. Rows already confirmed for earlier symbols in that cycle stay.
- **FR-4.** Symbols in a `GetFundamentalsMulti` chunk that failed are counted in the run's `deferred_count`, and
  the run finishes with status `"partial"` instead of `"completed"`. A budget-only deferral keeps
  `"budget_deferred"`; when a run has both, `"partial"` wins. `symbols_processed` counts only the symbols whose
  fundamentals were fetched, so a failed chunk's symbols are excluded from it (today `symbols_done=len(fetched)`).

## Consumer Surface(s)

The fix changes values an operator or analyst reads; it adds no new surface.

- **Agent tool** `run_fundamentals_scan` (`services/xstockstrat-agent/app/tools.py`): returns the run summary
  (`status`, `signals_emitted`, `deferred_count`), which now reports the corrected values and the new `"partial"`
  status.
- **UI** `/config-ui/fundamentals-scan` (`services/xstockstrat-ui/src/app/config-ui/fundamentals-scan/page.tsx`):
  shows `status` verbatim and `Deferred`, so it displays the corrected values with no code change.
- **Downstream** `list_opportunities`, the opportunity queue and signal-eligible live strategies receive the
  signals that were previously lost on a transient error. Their own interfaces do not change.

## Reproduction Steps

1. Run `run_once(force=False)` with one scored symbol `AAPL` and `IngestSignal` raising `UNAVAILABLE`. A claim row
   with `signal_id` NULL remains, and `signals_emitted=1`.
2. Re-run with `IngestSignal` healthy. `AAPL` is skipped.
3. Run with 60 symbols where the first chunk of 50 fails. Status is `completed` with `deferred=0`.

## Root Cause Hypothesis

One row means both "claimed" and "emitted". `_paced_fetch` has no bucket for failed chunks. See the report.

**Trade-off to settle in design.** A retry after a lost-but-committed `IngestSignal` response can double-emit.
Ingest's dedup claim (`services/xstockstrat-ingest/app/handlers/servicer.py:1039-1066`) overwrites, instead of
deduplicating, when `valid_until` differs, and the producer derives `valid_until` from `now` on every call. So
ingest's dedup does not make the retry idempotent today. Options include a deterministic `valid_until` per
`as_of_date`, or accepting the rare double row.

## Affected Services

- xstockstrat-analysis (fix site)
- xstockstrat-ingest (dedup semantics relevant to the retry; changes only if design moves idempotency there)

## Fix Scope

- [x] No proto wire changes. The `FundamentalsScanSummary.status` string comment
  (`packages/proto/analysis/v1/analysis.proto`) gains `"partial"`; this is a comment-only edit with no field change,
  so no breaking-proto approval gate applies. Re-run `./scripts/buf-gen.sh` after the edit so `proto-freshness` passes.
- [ ] Database migration: open, see Open Questions (OQ-1)
- [x] No config key changes anticipated

## Open Questions

Owned by `/sdd-design`; each must be resolved in `design.md`.

- **OQ-1. Claim state storage.** Option one reuses the existing nullable `signal_id`: a NULL row is an unconfirmed
  claim that a later run may retry or delete, with no migration. Option two adds a state column, which needs a new
  migration `services/xstockstrat-analysis/migrations/NNN_<desc>.up.sql` plus `.down.sql`. `NNN` is the next number
  above the existing analysis migrations, it runs in the normal `scripts/db-migrate.sh` order, and the column
  takes a default so that existing rows read as confirmed.
- **OQ-2. Retry idempotency.** A retry after a lost-but-committed `IngestSignal` response can double-emit (see
  Root Cause Hypothesis). Design either makes `valid_until` deterministic per `as_of_date`, so that ingest's dedup
  claim absorbs the retry, or accepts the rare double row. The choice adds an `@AC` for whichever behavior it picks.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Fundamentals scoring and neutral-score handling (feature 246)
- Unsupervised `run_forever` / `_tick` schedule errors (feature 259, D-07)
