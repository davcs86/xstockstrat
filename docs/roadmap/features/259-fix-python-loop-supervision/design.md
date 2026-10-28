# Design: fix-python-loop-supervision

**Created**: 2026-10-22
**Rounds**: 3 (full; termination: approved). The operator approved the round-3 synthesis at the gate and bound the positive poison allow-list as a condition. That condition resolves the one blocking objection left at r3, the classifier inversion. No Floor breach.
**Approved by**: operator @ 2026-10-22 (design gate r3; see context.md § Session 2026-10-22 — sdd-design approved)
**Grounded in**: recon.md

---

## Chosen Approach

Wrap the loops; do not harden each seam. One new shared helper module supervises the analysis background loops. The three copied config watchers get the same small edit in each service. The P&L-pattern consumer gets a per-event retry, a poison/replay/probe classifier and a recorded park. Nothing changes in proto, migrations or config keys (recon.md:202-222). The change is **internal-only**: no UI segment or Agent tool changes (C-14). Operators see it through logs, through the new `analysis.pnl.event_parked` ledger event, and through loops that keep producing.

### 1. Analysis supervision helper (FR-1, FR-2; D-07)

- New module `services/xstockstrat-analysis/app/supervision.py`. Recon found no supervisor, task registry or `add_done_callback` anywhere in the three services (recon.md:147-149, :279). It contains:
  - `spawn(coro, name, *, forever)`. It keeps the task in a module-level set and attaches `_on_done`.
  - `_on_done`. It logs the task name and the exception when a task exits unexpectedly. It stays silent when a one-shot completes, when a servicer `*_forever` takes its benign early return (`servicer.py:5917`, `:6088-6093`, `:6141`; recon.md:238-244), and on cancellation at shutdown. It must never raise during `serve()` start-up (recon.md:245-246; `@AC-3 @feature-171`).
  - `retry_until_ok`. It retries the seed until it succeeds.
  - `run_supervised(tick)`. It runs `while True: sleep(await tick())`. Its `except Exception` logs at error and sleeps `_LOOP_ERROR_BACKOFF_SECONDS=30` (a fixed invariant). The sleep sits **outside** the `try`, so the loop never busy-spins (recon.md:235-236; `@AC-5 @feature-156`).
- All eight boot sites in analysis `main.py` (`:143,167,174,194,211,215,221,225`; recon.md:22-29) go through `spawn`. Peer 262 reuses this helper for `:174` and does not add a second copy (context.md overlaps).
- The four `*_forever` loops become: seed via `retry_until_ok`, then the existing one-shot jitter, then `run_supervised(self._tick)`. The loops are `FundamentalsSignalLoop.run_forever` (`fundsignal_loop.py:158-165`) and the three servicer loops (`servicer.py:5906`, `:6082`, `:6139`) (recon.md:33-62).
  - The seams that are unguarded today, `next_sleep_seconds` and `advance` on both the success and the error path, are covered by the wrapper. No per-seam `try` is added (recon.md:30-62, :232-237).
  - When a tick's error-path `advance` itself fails, the schedule stays due and the 30 s loop backoff paces the retry. Once the DB is back, the `retry_seconds` cadence still governs (`@AC-4 @feature-156`).
  - The early returns, the jitter bounds and the wall-clock anchor are unchanged (`@AC-5/@AC-7 @feature-156`, `@AC-8 @feature-158`).
- `live_loop.run_forever` already guards its cycle (`live_loop.py:326-338`; recon.md:64-67). It only gets retention through `spawn`.

### 2. Config watcher reconnect and retention (FR-3; D-08)

The same edit lands in all three copies. Consolidating them is out of scope (D-20; recon.md:260-262). The copies are analysis `watcher.py:56,66-80`, indicators `:56,58-79` and ingest `:69,79-93` (recon.md:84-111).
- Widen `_watch`'s catch from `grpc.aio.AioRpcError` to `Exception`. Cancellation still propagates. The loop reconnects through the same single loop after the existing 2 s sleep. It must not spawn a second `_watch`, the stream-doubling shape (recon.md:226-228).
- Keep the last good snapshot across reconnects. That protects the zero-trap rules (recon.md:229-231; `@AC-1..4 @feature-173`).
- Rebuild the request through `_build_watch_request()` where it exists, so the `client_id` prefix stays the same (recon.md:135-137; `@AC-1/@AC-2 @feature-174`).
- Keep the task as `self._watch_task` and give it a local done-callback that logs an exit. The analysis watcher does not use `supervision.spawn`, so the three copies stay identical.
- Watcher tests patch `grpc.aio.secure_channel`, mtls and the stub, and they bound the loop (recon.md:263-265).

### 3. P&L-pattern consumer: retry, classify, replay, probe, park (FR-4, FR-5; D-56)

File: `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py`. Today `run_forever` swallows the per-event error and moves on (`:156-159`). The `GREATEST` cursor at `:408` then moves past the failed event (recon.md:68-83).

1. **Per-event retry.** `await self._process_with_retry(event)` replaces the per-event try at `:156-159`.
   - It makes up to `_EVENT_MAX_ATTEMPTS=3` attempts with `_EVENT_RETRY_BACKOFF_SECONDS=1.0` between them. The sleep sits outside the try.
   - Each attempt re-reads the cursor and returns early on `sequence <= cursor` (`:165-167`), so an attempt that committed partly is never applied twice and no ledger event is emitted twice (recon.md:247-249, :256-258; `@AC-7 @feature-042`, `@AC-10 @feature-029`).
   - Only an exception that escapes `process_event` counts as a failed attempt. A degraded snapshot (`@AC-17 @feature-225`) and a partial snapshot from a timeout (`@AC-6 @feature-042`) are successes (recon.md:253-255).
2. **Exhausted-event classification (operator decision r3, binding).** A consumer-local `_is_poison(e)` sits beside the constants at `:37-47`.
   - It is a positive allow-list. It returns True only for `ValueError`, `TypeError`, `KeyError`, the google.protobuf decode errors (`DecodeError`/`ParseError`), asyncpg `DataError` (SQLSTATE class 22) and `IntegrityConstraintViolationError` (class 23).
   - Poison: park with `reason="non-transient"`.
   - Everything else goes to replay and the probe. That includes `OutOfMemoryError` 53200, `DeadlockDetectedError`/`SerializationError` (class 40) and `DiskFullError`/`InsufficientResourcesError`.
   - `read_budget.is_transient_db_error` is **not** used to decide parking, and `read_budget._TRANSIENT` is not imported. Both are allow-lists that default to non-transient, which is the opposite of what this policy needs.
3. **Replay counter and reset rule (operator decision r2 (1)).** The in-memory pair is `_replay_seq: int | None` and `_replay_count: int`. If `event.sequence == _replay_seq`, add 1; otherwise set it to `(seq, 1)`. Then re-raise to the outer reconnect handler (`:160-162`).
   - Logging is warning below `_REPLAY_ESCALATE_AFTER=5` and error from 5 on. The line names the sequence, event_type and correlation_id.
   - **Reset** right after `_process_with_retry` returns, and only `if self._replay_seq is not None and event.sequence >= self._replay_seq`. Also reset on park.
   - The cursor's own row is re-delivered inclusively on every reconnect. Its sequence is the cursor, which is below `_replay_seq`, and it takes the early return, so it never resets the counter.
4. **DB-health probe at K (operator decision r2 (2), bounded).** When `_replay_count >= 5`, run exactly one `await asyncio.wait_for(self._cursor(), _PROBE_TIMEOUT_SECONDS)` (`_cursor` is at `:140-145`) inside its own try.
   - The probe raises or times out: treat the DB as down or the pool as exhausted. Log at error and re-raise to reconnect. There is no park and no time cap.
   - The probe returns: park inline with `reason="transient-persistent"` and continue the `async for`.
5. **Outer-handler escalation.** Add `_stream_fail_count`.
   - The outer except at `:160-162` increments it. It logs warning below 5 consecutive failures and error from the 5th on.
   - It resets on the first event the stream delivers.
   - This covers a full outage in which `_cursor()` at `:151` raises before `StreamEvents` opens (fails.md:1616).
6. **Park sequence (fixed order).**
   - (a) A structured `log.error` with sequence, event_id, event_type, correlation_id, attempts, reason, and the identity key (user_id/account_id/symbol) when the payload has it.
   - (b) `await self._emit("analysis.pnl.event_parked", f"pnl_park:{seq}", payload, correlation_id=event.correlation_id, idempotency_key=f"pnl_park:{seq}", timeout=_PARK_EMIT_TIMEOUT_SECONDS)`. A `DEADLINE_EXCEEDED` is swallowed by `_emit`'s existing except at `:434`.
   - (c) `_advance_cursor(event.sequence)` (`:399`; recon.md:131-133).
   - (d) Reset the replay pair.

   A raise in (c) propagates to the reconnect handler without running (d). The re-park on replay is deduplicated by the ledger idempotency key. Both the poison branch and the transient-persistent branch follow this order. On the way back in, the park event is skipped by the self-emission rule (`:170-174`). This order puts a durable record ahead of the advance (recon.md:250-252).
7. **`_emit` (`:415`)** gains keyword-only `correlation_id=""`, `idempotency_key=""` and `timeout=None`. A non-empty correlation_id is also sent as `x-trace-id` call metadata.
   - Under the operator's standing 2026-10-21 trace decision (C-03), the existing post-commit emits at `:243` and `:299` now pass `correlation_id=event.correlation_id`.
   - Their `timeout` stays `None`, so their latency is unchanged.
8. **Fixed invariants, not config keys** (the `servicer.py:346-347` precedent; recon.md:125-127; `@AC-7 @feature-158` fixed-invariant branch): `_EVENT_MAX_ATTEMPTS=3`, `_EVENT_RETRY_BACKOFF_SECONDS=1.0`, `_REPLAY_ESCALATE_AFTER=5`, `_PROBE_TIMEOUT_SECONDS` (the spec pins it; suggested 5), `_PARK_EMIT_TIMEOUT_SECONDS=5` and `_LOOP_ERROR_BACKOFF_SECONDS=30`. They are documented in the analysis `CLAUDE.md`.

### 4. Acceptance, spec and docs edits (C-15)

- Edit this feature's own `@AC-7` to read: "a poison error (payload/logic, SQLSTATE 22/23) on every attempt, or a non-poison error that persists while the bounded DB probe succeeds". Add a step that records the `analysis.pnl.event_parked` ledger event. Amend FR-5 in product-spec.md to match.
- Add `@AC-9 @feature-259`: no park while the probe fails or times out, and the 5th replay logs ERROR naming the sequence.
- Add `@AC-10 @feature-259`: when `_cursor()` raises on every call, the 5th consecutive stream failure logs ERROR.
- Tests:
  - Fake-stream tests use a fake `StreamEvents` async iterator added to `FakeLedger` (`tests/test_pnl_pattern_consumer.py:138`; recon.md:144-146).
  - The reset-rule test re-yields the cursor row, then N+1 failing, five times.
  - Probe tests cover both outcomes: fail or time out, and succeed.
  - The park-order test checks log → emit (with idempotency_key) → advance.
  - The park-failure test raises in `_advance_cursor` and asserts there is no reset and the re-park is deduplicated.
  - **OOM/deadlock test:** `OutOfMemoryError` and `DeadlockDetectedError` go to replay, not to an immediate park.
  - Existing emits carry correlation_id.
  - Loop test sentinels must be `BaseException` with the sleep outside the try (recon.md:139-140).
- Analysis `CLAUDE.md` § P&L pattern consumer:
  - the retry, poison, replay, probe and park rules;
  - an `analysis.pnl.event_parked` row in Ledger Events Emitted;
  - the fixed invariants;
  - the accepted limitations (Open Risks).

### Build order

Spec steps follow recon.md:301-319:
1. retention plus the `supervision.py` helper;
2. loop survival;
3. watcher edits in all three services;
4. the P&L consumer;
5. docs and teardown.

Step 4 rebases onto peer 248, which re-greps `pnl_pattern_consumer.py:147-162`. The watcher and tick steps rebase against 244/246/260 (recon.md:268-277).

## Rejected Alternatives

- **Reusing `read_budget.is_transient_db_error` to classify consumer errors (r3).** It is an allow-list whose default is non-transient, so OOM (53200), deadlock/serialization (class 40) and disk-full would park within about 2 s and lose data. A misclassification on the read path costs a 500; here it costs data permanently.
- **Widening `read_budget._TRANSIENT` to cover classes 40/53.** It changes the read-path status mapping (P-03) to fix a consumer-policy problem.
- **K=5 with two consecutive probe confirmations (r3 runner-up).** It doubles the time to park real poison (about 50-60 s) and does not fix the classifier gap. The spec may revisit it if contention-driven false parks turn out to be frequent.
- **Probing the failing event's own tables (`SELECT 1 FROM analysis.pnl_positions`).** It is just as blind to statement timeouts, so the gain is marginal.
- **`asyncio.wait_for` around the park `_emit` at the call site (r3).** It adds a second error path. A keyword-only gRPC timeout inside `_emit`, swallowed by the existing except, is simpler (C-18).
- **Keeping the existing post-commit emits byte-identical, with no correlation_id.** That contradicts the operator's 2026-10-21 trace-propagation decision, and threading the value through costs 2 lines.
- **Resetting the escalation counter on any successful `process_event` (r2).** The inclusive cursor-row replay would reset it on every reconnect (fails.md:1616).
- **Replaying forever on any transient error (r2).** It narrows FR-5 without operator sign-off.
- **Parking after a wall-clock cap, or after N escalations without a probe.** Both park good events during a real outage.
- **Park order log → advance → emit.** A crash between the advance and the emit loses the ledger record.
- **A persisted per-sequence attempt table, or a migration-028 parked-events table.** In-memory state is enough with instance_count 1. A table brings a DBA gate and peer migration-number collision risk (260/262/272), and could leak into `QueryPnLPatterns`.
- **Labelling the in-feature `@AC-7` edit as CHANGE.** It is this feature's own unlaunched scenario, so it is edited directly.
- **Carried over from r1/r2:**
  - Per-seam try hardening inside the ticks.
  - A new local `_TRANSIENT` tuple.
  - Tolerating a failed seed.
  - Moving the seed into `run_supervised`.
  - Capped exponential backoff for loops and watchers.
  - Retrying by reconnecting the stream.
  - A per-caller backoff callable.
  - The analysis watcher using `supervision.spawn`; it would break three-copy symmetry.

## Open Risks

- [ ] **Probe false park under load.** `_cursor()` can succeed while a heavy valid event keeps hitting QueryCanceledError or statement timeouts from contention. The event is then parked after about 25-30 s: the close's realized_pnl is lost and its window stays open. The damage is limited because the park is recorded exactly once in the ledger with its identity key. To be addressed at: /sdd-spec step 4 (document it; revisit two-confirmation K if it shows up in practice).
- [ ] **Poison allow-list incompleteness.** An unlisted deterministic payload bug, such as AttributeError or ZeroDivisionError, parks about 25-30 s later instead of about 2 s. That is safe, only slower. The list must stay narrow. To be addressed at: step 4 (CLAUDE.md note).
- [ ] **Attempt hang.** `pool.acquire()`/`fetchval` have no timeout (`:141`, `:205`, `:268`, `:400`). Pool exhaustion can stall an attempt before the probe is ever reached, and FR-2's done-callback never fires. To be addressed at: /sdd-spec step 4 (decide whether attempts get the same bound).
- [ ] **Parked-event side effects.** A parked `order.created`/`filled` opens no window, so its later close no-ops (`sealed is None`, `:281`). A parked `position.closed` leaves its window open with a stale opened_at. Both are accepted limitations that can be reconciled from the park payload. To be addressed at: step 5 (analysis CLAUDE.md).
- [ ] **Ledger replay amplification.** Each stuck event causes up to 5 unpaged `StreamEvents` re-queries on ledger's single query connection (fails.md:3006-3010). To be addressed at: /sdd-spec (coordinate with peer fix-ledger-query-pagination in merge-order.md).
- [ ] **Trace field and mTLS acceptance (unverified).** Confirm that `LedgerEvent.correlation_id` (ledger.proto:28) carries the originating x-trace-id and does not go into metadata (field 8). Confirm that ledger `AppendEvent` accepts a call with x-trace-id metadata and no x-user-id under mTLS. This covers both the new park emit and the existing `:243`/`:299` emits. To be addressed at: /sdd-spec step 4 discovery.
- [ ] **Unpersisted counters.** The replay and stream-fail counters are not persisted, so a restart delays escalation by K. This is acceptable with instance_count 1. To be addressed at: step 5 (CLAUDE.md note).
- [ ] **Carried over.**
  - The opportunity tick runs a full all-user recompute every 30 s if `servicer.py:5903` keeps failing.
  - Loop-test sentinels must be `BaseException`, with the sleep outside the try.
  - Watchers re-dial every 2 s during a long config outage.

  To be addressed at: steps 2-3 (tests) and step 5 (docs).

## Constitution Rules Touched

- `C-01`: honored. The design is grounded in recon.md and read before change. Every claim cites recon.md or the code.
- `C-03`: honored. x-trace-id is carried from `event.correlation_id` on the park emit and on the existing `:243`/`:299` emits (operator 2026-10-21). Background loops keep their own context and mint none per request. The header trio is unchanged across retry and reconnect (`@AC-5 @feature-210`).
- `C-08`: honored. Each FR maps to ACs, and each AC gets a paired test (red before green at execute).
- `C-11`: honored. Full-mode debate over 3 rounds, with the operator gate approval recorded in context.md and a design-phase ledger check.
- `C-15`: honored. `@AC-7` is edited, and `@AC-9`/`@AC-10` are added in this feature's `acceptance.feature`. FR-5 is amended to match.
- `C-16`: honored. All prior durable rules are PRESERVE, and this feature's scenarios are EXTEND (see below). There is no CHANGE.
- `C-18`: honored. One shared helper and no new tables or keys. `_emit` is extended rather than duplicated.
- `F-07`: honored. No hardcoded operator-tunable value is introduced. The new constants are justified fixed invariants under the `servicer.py:346-347` precedent and documented in the analysis CLAUDE.md. The watcher backoff cannot be a config key, because it is the client that delivers config (recon.md:218-219).
- `P-02`: honored. The proposer and adversary exchanges were mediated through syntheses only.
- `P-03`: honored. Nothing is silently absorbed. Out-of-scope siblings (ingest `main.py:127`, servicer fire-and-forget tasks) are left untouched (recon.md:287-290). The emit-request change is sanctioned by an explicit operator rule.
- `D-20`: honored. The three watcher copies get identical edits. Consolidation is out of scope.
- Floor (`F-*`): no breach.

## Business Rules Touched (C-16)

- PRESERVE `@AC-7 @feature-158` "A migrated loop's jitter and retry cadence are configuration-driven, not hardcoded" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`). Not regressed: the jitter and `retry_seconds` stay config-driven, and the new backoffs are documented fixed invariants.
- PRESERVE `@AC-9 @feature-158` "The opportunity refresh retries soon after a user-enumeration failure" (same suite). Not regressed: the enumeration-failure `advance(retry)` is unchanged, and the wrapper only catches a failing `advance`.
- PRESERVE `@AC-3/@AC-4/@AC-5 @feature-156` (crash re-runs promptly; caught error retries after retry_seconds; a disabled producer does not busy-spin) (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`). Not regressed: the backoff never advances the schedule, and the sleep sits outside the try.
- PRESERVE `@AC-1..4 @feature-173` zero-trap (ingest/indicators suites). Not regressed: the last good snapshot is kept across reconnect.
- PRESERVE `@AC-1/@AC-2 @feature-174` client_id prefix (analysis/ingest suites). Not regressed: reconnect still goes through `_build_watch_request()`.
- PRESERVE `@AC-3 @feature-171` "Telemetry init remains non-blocking" (`docs/sdd/business-rules/platform.feature`). Not regressed: `spawn`/`_on_done` never raise at boot.
- PRESERVE `@AC-2 @feature-042` "Closing a position triggers pattern analysis" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`). Not regressed: on the happy path there is a single attempt and no added latency. Class-40/53 errors replay instead of parking.
- PRESERVE `@AC-6 @feature-042` "A snapshot-capture timeout never blocks order execution" (same suite). Not regressed: a partial snapshot is a success, not a failed attempt.
- PRESERVE `@AC-7 @feature-042` "Snapshot and pattern events are recorded in the ledger" (same suite). Not regressed: retries short-circuit on `sequence <= cursor`, so nothing is emitted twice. The existing emits only add correlation_id/x-trace-id, which the operator sanctioned.
- PRESERVE `@AC-10 @FR-4 @feature-029` "A per-fill fee flows through the fee-capture plumbing" (`docs/sdd/business-rules/platform.feature`). Not regressed: `fees_total` persists exactly once, and transient DB errors replay instead of parking.
- PRESERVE `@AC-3 @FR-4 @feature-042 @feature-225` "QueryPnLPatterns returns the caller's ranked factors". Not regressed: no table is added, and the park goes only to the ledger.
- PRESERVE `@AC-17 @feature-225` "An ownerless order event issues no owner-scoped call" (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`). Not regressed: the degraded snapshot is a success.
- PRESERVE `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`docs/sdd/business-rules/platform.feature`). Not regressed: the trio is unchanged, and x-trace-id is only added where it was missing.
- EXTEND `@AC-1..@AC-6 @feature-259`, `@AC-8 @feature-259`. New failure-survival cases, under the operator scope decision D-07/D-08/D-56 (2026-10-21/22, context.md).
- EXTEND `@AC-7 @feature-259`. An in-feature edit: poison allow-list, or probe-confirmed transient-persistent, and the park ledger event is recorded. Covered by operator decisions r2 (probe) and r3 (binding poison allow-list), 2026-10-22.
- EXTEND `@AC-9 @feature-259` (new). No park while the bounded probe fails or times out, and the 5th replay logs ERROR. Covered by operator decision r2 (reset rule and probe), 2026-10-22.
- EXTEND `@AC-10 @feature-259` (new). The 5th consecutive stream or cursor failure logs ERROR. This is within D-56 scope and covered by the operator's r3 "APPROVED as synthesized" gate decision (2026-10-22), which approved the synthesis that adds it.
- CHANGE: none.
