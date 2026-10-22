# Product Spec: fix-python-loop-supervision

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-python-loop-supervision-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-07.** The analysis background loops guard only their cycle body. `DurableSchedule.seed` / `next_sleep_seconds` /
  `advance` (`services/xstockstrat-analysis/app/engine/durable_schedule.py:57,75,91`, no try) run unguarded in
  `FundamentalsSignalLoop.run_forever` (`app/engine/fundsignal_loop.py:158-165`). `_tick` also calls
  `_advance_schedule` inside its own `except` (`:152-155`). The same shape is in `run_opportunity_refresh_forever`
  (`app/handlers/servicer.py:5925-5930`), `run_readiness_materializer_forever` (`:6100-6106`) and
  `run_template_intent_sweep_forever` (`:6144-6146`). One transient DB error ends the loop for the life of the
  process. Every loop is started by a bare, unretained `create_task` (`app/main.py:143,167,174,194,211,215,221,225`)
  with no done-callback, so the death is silent and health stays green.
- **D-08.** `ConfigWatcher._watch` catches only `grpc.aio.AioRpcError` in analysis (`app/config/watcher.py:66-80`),
  indicators (`:58-79`) and ingest (`:79-93`). Any other exception ends the watch. The task is unretained
  (`watcher.py:56` / `:56` / `:69`), so config silently freezes at the last snapshot.
- **D-56.** `PnLPatternConsumer.run_forever` logs and skips a failed `process_event`
  (`app/engine/pnl_pattern_consumer.py:155-159`). The next event's cursor write uses `GREATEST` (`:403-412`), so the
  failed sequence is never replayed.

**Expected.** Every background loop survives any exception, logs it, backs off and continues. Started tasks are
retained with a done-callback that logs an unexpected exit. `_watch` reconnects after any exception with a log and a
backoff. A transiently failing ledger event is retried before the cursor passes it; a poison event is parked under an
explicit, logged rule.

## Reproduction Steps

1. D-07: make `DurableSchedule.next_sleep_seconds` raise `asyncpg.PostgresConnectionError` once under
   `FundamentalsSignalLoop.run_forever()`. The task finishes with the exception and never ticks again.
2. D-08: make the `WatchConfig` stream iterator raise `RuntimeError("boom")`. `_watch` exits and never reconnects
   (all three services).
3. D-56: stream events 10 and 11. Make `process_event` raise a connection error for 10 only. The cursor ends at 11 and
   event 10 is never processed.

## Root Cause Hypothesis

Per-cycle hardening without a shared supervised-loop helper or task registry; a gRPC-only reconnect handler; and a
"skip so the loop survives" rule combined with a monotonic cursor. See the report for the per-finding detail.

## Affected Services

- xstockstrat-analysis (D-07, D-08, D-56 — main fix site)
- xstockstrat-indicators (D-08 — config watcher copy)
- xstockstrat-ingest (D-08 — config watcher copy)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated (D-56 park rule may need a parked-events table — design decides; if so, DBA review applies)
- [ ] No config key changes anticipated — a backoff or retry-count knob for D-56 may be proposed; design decides

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- The zero-value getter trap in the same `watcher.py` files (feature 244)
- A loop heartbeat / liveness metric (debt-radar trade-off note; signal-map follow-up), unless design finds it necessary
- Consolidating the three `watcher.py` copies into a shared package (D-20)
