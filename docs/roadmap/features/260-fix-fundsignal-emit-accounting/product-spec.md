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

- [x] No proto changes anticipated
- [ ] No database migrations anticipated — claim-then-confirm can reuse the existing nullable `signal_id`; a new state column would need a migration (design decides)
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Fundamentals scoring and neutral-score handling (feature 246)
- Unsupervised `run_forever` / `_tick` schedule errors (feature 259, D-07)
