# Recon: fix-python-loop-supervision

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-indicators, xstockstrat-ingest
**Severity**: SEV-2 (Track C; scope D-07, D-08, D-56 — operator decisions 2026-10-21)

---

## Objective

Make the Python background work survive any exception. The four analysis `DurableSchedule` loops must
survive errors in their schedule seams as well as their cycle body. Boot tasks must be retained, with a
done-callback that logs an unexpected exit. The three `ConfigWatcher._watch` copies must reconnect after any
exception, not only `grpc.aio.AioRpcError`. `PnLPatternConsumer` must retry a failing ledger event before its
cursor passes it, and park a poison event under an explicit, logged rule. Today one transient fault silently
kills a loop or freezes config while health stays green (D-07, D-08, D-56).

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.13, asyncio + `grpc.aio`)
  - Entry point: `services/xstockstrat-analysis/app/main.py` — `serve()` ends with
    `await grpc_server.wait_for_termination()` at `:228`. Boot tasks, all bare
    `asyncio.get_event_loop().create_task(...)` with no retained handle and no done-callback:
    `:143` `_boot_recompute()` (one-shot), `:167` `live_loop.run_forever()`, `:174` `backfill_entry_times(...)`
    (one-shot), `:194` `fundsignal_loop.run_forever()`, `:211` `pnl_pattern_consumer.run_forever()`,
    `:215` `servicer.run_opportunity_refresh_forever()`, `:221` `servicer.run_readiness_materializer_forever()`,
    `:225` `servicer.run_template_intent_sweep_forever()`. `:120` is the shutdown `grpc_server.stop(grace=5)`
    task, which is out of scope.
  - Shared scheduler: `app/engine/durable_schedule.py` — `DurableSchedule.__init__(db_pool, job_name, mode, *,
    user_id="", anchor_hour=None)` `:40`. `seed` `:57`, `next_sleep_seconds` `:75` and `advance` `:91` contain no
    `try`. Callers own all error handling.
  - Fundamentals loop: `app/engine/fundsignal_loop.py`
    - The wrappers `_seed_schedule` `:111`, `_next_sleep_seconds` `:117` and `_advance_schedule` `:122` delegate
      to `self._schedule`.
    - `_tick` `:128-156` calls `_next_sleep_seconds` at `:131`, outside any `try`.
    - The cycle `try` is at `:146-155`. Its `except Exception` at `:152` calls
      `await self._advance_schedule(retry)` at `:155`, which is unguarded and can raise out of the handler.
    - `run_forever` `:158-165`: `await self._seed_schedule()` `:160`, a one-shot jitter sleep `:162-163`, then
      `while True: await asyncio.sleep(await self._tick())` `:164-165`.
  - Servicer loops: `app/handlers/servicer.py`
    - `_opportunity_refresh_tick` `:5874`.
      - `next_sleep_seconds` `:5882` is unguarded.
      - On an enumeration failure it calls `advance(retry)` at `:5891`, after the `except`, unguarded.
      - The per-user `except` is at `:5899`.
      - The final `advance` at `:5903` is unguarded.
    - `run_opportunity_refresh_forever` `:5906`: early `return` when the repo is `None` (`:5917-5918`),
      `seed` `:5925`, jitter `:5927-5928`, loop `:5929-5930`.
    - `_readiness_materializer_tick` `:6050`.
      - `next_sleep_seconds` `:6055` is unguarded.
      - The kill-switch-off `advance` `:6060` is unguarded.
      - On an enumeration failure it calls `advance(retry)` at `:6067`.
      - The per-owner `except` is at `:6076`.
      - The final `advance` `:6079` is unguarded.
    - `run_readiness_materializer_forever` `:6082`: early `return` at `:6088-6093`, `seed` `:6100`, jitter
      `:6103-6104`, loop `:6105-6106`.
    - `_template_intent_sweep_tick` `:6110`.
      - `next_sleep_seconds` `:6113` is unguarded.
      - The enumeration `except` (`:6122`) and the per-intent `except` (`:6134`) both swallow.
      - `advance(_INTENT_SWEEP_SECONDS)` `:6136` is unguarded.
    - `run_template_intent_sweep_forever` `:6139`: early `return` `:6141-6142`, `seed` `:6144`, loop
      `:6145-6146` (no jitter).
    - Fixed invariants `_INTENT_STALE_SECONDS = 900` `:346` and `_INTENT_SWEEP_SECONDS = 300` `:347`.
  - Live loop (the guarded counter-example, not named by FR-1): `app/engine/live_loop.py:326-338`.
    - `while True` reads `get_int("analysis.engine.eval_interval_seconds")`, sleeps, then
      `try: await self._run_cycle() except Exception: log.error(...)` (`:335-338`).
    - Only the in-memory `get_int` and the `sleep` are outside the `try`. It needs task retention (FR-2) only.
  - P&L consumer: `app/engine/pnl_pattern_consumer.py`
    - Constants `CONSUMER_NAME = "pnl_pattern"` `:37`, `ORDER_EVENTS` `:41` and `CLOSE_EVENT` `:47`.
    - `_cursor()` `:140-145` runs `SELECT last_sequence FROM analysis.ledger_stream_cursor WHERE consumer=$1`.
    - `run_forever` `:147-162`. The per-event `try: await self.process_event(event)` (`:156-157`) is followed by
      `except Exception as e:  # noqa: BLE001 — one bad event never kills the loop` (`:158`) and
      `log.warning("pnl consumer: event %s error: %s", event.event_id, e)` (`:159`), after which the loop takes
      the next event. The outer `except Exception` (`:160-162`) re-reads the cursor and reopens `StreamEvents`
      after `sleep(2)`.
    - `process_event` `:164`.
      - It re-reads the cursor at `:165`, then short-circuits `event.sequence <= cursor` at `:167`.
      - Self-emissions advance the cursor at `:170-174`.
      - Other events dispatch to `_handle_order_event` / `_handle_close_event` / `_advance_cursor` at `:178-183`.
    - `_advance_cursor` `:399`. `_advance_cursor_conn` `:403-413` does
      `ON CONFLICT (consumer) DO UPDATE SET last_sequence = GREATEST(...)` (`:408`).
    - The order and close handlers advance the cursor inside their own DB txn (the analysis `CLAUDE.md`
      § "P&L pattern consumer" "ONE txn" rule).
  - Config watcher: `app/config/watcher.py`
    - `class ConfigWatcher` `:37`. `__init__(endpoint, namespace)` `:43` builds the mTLS channel and stub, then
      runs `asyncio.get_event_loop().create_task(self._watch())` at `:56`, unretained.
    - `_build_watch_request` `:58`.
    - `_watch` `:66-80` catches only `grpc.aio.AioRpcError` (`:78`), logs `"config stream error: %s,
      reconnecting in 2s"`, then `await asyncio.sleep(2)` (`:80`).
    - Analysis builds two watchers (`cfg_watcher` and a second `ConfigWatcher(namespace="marketdata")`), so the
      fix covers both instances automatically.
  - Last migration: `027_contract_owner_dimension.up.sql` / `.down.sql`
    (`services/xstockstrat-analysis/migrations/`). Globbing `02[89]*` finds nothing there.
  - Config-read pattern: presence-aware retry cadence
    `max(1, self._cfg.get_int_present("analysis.fundsignal.retry_seconds", 300))`
    (`fundsignal_loop.py:154`), with the same shape at `servicer.py:5890` and `:6066`.
- **`xstockstrat-indicators`** (Python 3.13)
  - Config watcher: `services/xstockstrat-indicators/app/config/watcher.py`
    - `class ConfigWatcher` `:37`, `__init__` `:43`, unretained task `:56`.
    - `_watch` `:58-79` builds the `WatchConfigRequest` inline (no `_build_watch_request` helper).
      `except grpc.aio.AioRpcError` is at `:77` and `sleep(2)` at `:79`.
  - Entry point: `app/main.py:89-90`. These are shutdown-only `create_task` calls (`grpc_server.stop`,
    `db_pool.close`), out of scope.
  - Last migration: not relevant (no DB change in indicators).
- **`xstockstrat-ingest`** (Python 3.13)
  - Config watcher: `services/xstockstrat-ingest/app/config/watcher.py`
    - `class ConfigWatcher` `:50`, `__init__` `:56`, unretained task `:69`, `_build_watch_request` `:71`.
    - `_watch` `:79-93`: `except grpc.aio.AioRpcError` `:91`, `sleep(2)` `:93`.
  - Entry point: `app/main.py:127` `asyncio.create_task(run_mcp_client_loop(...))`, unretained. This is a sibling
    loop **outside** the spec's scope; `:137` is shutdown.
  - Last migration: not relevant.

## Patterns to REUSE

- **Per-cycle swallow + log + continue** → the existing `try … except Exception as e:  # never let one bad cycle
  kill the loop` + `log.error(...)` shape. See `live_loop.py:335-338`, `fundsignal_loop.py:152-153`, and the
  per-item swallows at `servicer.py:5899`, `:6076`, `:6134`. FR-1 extends this shape outward to cover the
  schedule seams; it does not invent a new idiom.
- **Capped exponential reconnect backoff with fixed constants** → the Node `ConfigWatcher` precedent from
  `69c8554`: `RECONNECT_BASE_MS = 1_000` / `RECONNECT_MAX_MS = 30_000`, attempt counter reset on a received
  snapshot, `Math.min(MAX, BASE * 2 ** attempt)` (`services/xstockstrat-ledger/src/services/configWatcher.ts:15-16,
  25-26,57,85-88`). It is the closest in-repo template for D-08's broader catch + backoff. It is also the
  precedent for making the watcher's backoff a code constant rather than a config key, since a config key would be
  circular for the config watcher itself (peer 258 makes the same argument for config's LISTEN client).
- **Fixed-invariant constants (not config keys)** → `_INTENT_SWEEP_SECONDS` / `_INTENT_STALE_SECONDS`
  (`servicer.py:346-347`), documented as "fixed invariants, not config keys" in the analysis `CLAUDE.md`. Use
  this for a loop-error backoff or a consumer retry bound if design does not want an operator knob.
- **Config-driven retry cadence** (if design wants a knob) → `get_int_present(... , default)` clamped
  `max(1, …)` (`fundsignal_loop.py:154`). A new key would be `analysis.<category>.<key>` with its default declared
  in `services/xstockstrat-analysis/CLAUDE.md` § Config Keys Consumed (C-05, F-07).
- **Cursor advance for a parked event** → `PnLPatternConsumer._advance_cursor(sequence)` (`pnl_pattern_consumer.py:399`)
  over `_advance_cursor_conn`'s `GREATEST` upsert (`:403-413`). The park path reuses it; there is no new cursor
  write.
- **Broad-except lint marker** → the `# noqa: BLE001 — <reason>` comment style (`pnl_pattern_consumer.py:158,160`).
- **Watch request seam** → keep `_build_watch_request()` (analysis `:58`, ingest `:71`) as the reconnect request
  builder, so `client_id` stays stable across reconnects (ledger insights 2026-09-09, feature 174 — whole-request
  wire-object seam).
- **Test seams:**
  - Sentinel to break an infinite loop: `class _StopLoop(Exception)` (`tests/test_fundsignal_loop.py:375`).
    Monkeypatch `_tick` and `asyncio.sleep` as in the run_forever tests that use it.
  - Schedule-level helper `_sched_loop` (`:379`). `_make_loop` (`:45`) and `_make_cfg` (`:20`) build the loop.
  - The servicer ticks take the schedule as an argument, so tests drive them directly
    (`tests/test_opportunity_refresh.py` and `test_readiness_materializer.py`).
  - The P&L consumer fakes are in `tests/test_pnl_pattern_consumer.py`: `make_event` (`:22`), `FakePool` (`:59`),
    `FakeLedger` (`:138`, which has only `AppendEvent`, so AC-6/AC-7 need a fake `StreamEvents` async iterator
    added), `FakeCfg` (`:147`, which has only `get_int`) and `make_consumer` (`:177`).
- **Shared supervisor helper:** none exists. A grep for `add_done_callback`, `_background_tasks`, `task_registry`
  and `supervis` across `services/xstockstrat-{analysis,indicators,ingest}/app/**` returns nothing. Whatever
  design picks for FR-2 is new code, and this feature owns it (context.md: 262 reuses it, not a second copy).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-1 @feature-156` "The producer runs its first cycle promptly on a fresh deploy, not after a full interval" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — The loop's first tick is prompt. The supervised wrapper adds no startup delay.
- **PRESERVE** `@AC-2 @feature-156` "A redeploy within the interval does not reset the schedule" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — The loop sleeps only the remaining time. Recovery must not re-arm a full interval.
- **PRESERVE** `@AC-3 @feature-156` "A hard crash mid-cycle re-runs promptly on restart, not after a full interval" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — An unadvanced `blocked_until_ms` stays due. Backoff must not advance it.
- **PRESERVE** `@AC-4 @feature-156` "A caught cycle error retries after retry_seconds, not a full interval" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — The `except` path advances by `retry_seconds`. FR-1 hardens `_advance_schedule` inside it without changing the cadence.
- **PRESERVE** `@AC-5 @feature-156` "A disabled producer neither runs nor advances the schedule" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — A disabled producer neither runs, nor advances, nor busy-spins. Backoff must not break this.
- **PRESERVE** `@AC-6 @feature-156` "A manual scan does not contaminate the scheduled cadence" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — `RunFundamentalsScan` leaves `blocked_until_ms` unchanged.
- **PRESERVE** `@AC-7 @feature-156` "Startup jitter is bounded" (`services/xstockstrat-analysis/acceptance/fix-fundamentals-signal-producer.feature`) — The jitter stays in [0, N].
- **PRESERVE** `@AC-1 @feature-158` "The shared helper computes sleep-until-due without polling and advances only after a run" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — `next_sleep_seconds` semantics are unchanged. FR-1 wraps the call and does not change what it returns.
- **PRESERVE** `@AC-2 @feature-158` "The shared helper writes the next-due time only after a completed interval run" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — `advance` runs only after completion. A caught error advances by the retry cadence.
- **PRESERVE** `@AC-3 @feature-158` "The generalized schedule row is keyed by job and user" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — The `(job_name, user_id)` keying is unchanged.
- **PRESERVE** `@AC-7 @feature-158` "A migrated loop's jitter and retry cadence are configuration-driven, not hardcoded" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — A new backoff or retry knob must also be config-driven (F-07), or be justified as a fixed invariant.
- **PRESERVE** `@AC-8 @feature-158` "The daily opportunity refresh re-anchors to its wall-clock hour across a redeploy" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — `run_opportunity_refresh_forever` keeps its wall-clock anchor. A supervised restart must not reset it.
- **PRESERVE** `@AC-9 @feature-158` "The opportunity refresh retries soon after a user-enumeration failure instead of skipping the day" (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — An enumeration failure advances by about `retry_seconds`. Partial per-user failures advance to the next hour.
- **PRESERVE** `@AC-6 @feature-224` "The fundamentals loop still runs the system scoring formula" (`docs/sdd/business-rules/platform.feature`) — A retried tick keeps `x-user-id: system` with `x-internal-caller: analysis-fundsignal`.
- **PRESERVE** `@AC-36 @feature-224` "System slugs are reserved in both directions" (`docs/sdd/business-rules/platform.feature`) — A slug conflict still aborts the cycle with an ERROR alert. The error is not swallowed or silently retried.
- **PRESERVE** `@AC-37 @feature-224` "Fundamentals scan fails closed on a non-system scoring formula" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`) — The abort path (no emit, ERROR log and alert) still holds under the supervised wrapper.
- **PRESERVE** `@AC-2 @feature-042` "Closing a position triggers pattern analysis and materializes factor rows" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — Factor rows are written within 10 s of a close event. The FR-4 retry must keep this on the happy path.
- **PRESERVE** `@AC-7 @feature-042` "Snapshot and pattern events are recorded in the ledger with their event types" (`services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`) — A retried event must not double-emit ledger events.
- **PRESERVE** `@AC-17 @feature-225` "An ownerless order event issues no owner-scoped call" (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`) — A degraded snapshot is a success. It is not a failure to retry or park.
- **PRESERVE** `@AC-6 @feature-180` "A watchlist binding to a non-live strategy is not materialized" (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`) — The materializer neither raises nor halts over a non-live binding.
- **PRESERVE** `@AC-4 @feature-180` "A large materialization cycle stays within the resource envelope" (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`) — The separate semaphore, pool bound and interactive latency are unchanged. Backoff must not raise concurrency.
- **PRESERVE** `@AC-2 @feature-180` (materializer universe is owner-scoped) (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`) — Unchanged.
- **PRESERVE** `@AC-1 @feature-174` "The analysis watcher identifies as an analysis subscriber" (`services/xstockstrat-analysis/acceptance/fix-config-watcher-client-id.feature`) — The reconnect path rebuilds the request with the `analysis-` `client_id` prefix.
- **PRESERVE** `@AC-2 @feature-174` "The ingest watcher identifies as an ingest subscriber" (`services/xstockstrat-ingest/acceptance/fix-config-watcher-client-id.feature`) — The reconnect keeps the `ingest-` `client_id` prefix.
- **PRESERVE** `@AC-1/@AC-2/@AC-3 @feature-173` "present-aware config reads (0 is a value, not unset)" (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`) — The ingest watcher snapshot and `get_int_present` semantics are untouched. Feature 244 owns the getter trap.
- **PRESERVE** `@AC-4 @feature-173` "An empty allowed_imports denies all sandbox imports instead of reverting to the permissive default" (`services/xstockstrat-indicators/acceptance/fix-python-config-zero-trap.feature`) — The indicators snapshot and `get_str_present` semantics are untouched.
- **PRESERVE** `@AC-6 @feature-210` "A long-lived streaming RPC survives a certificate rotation" (`docs/sdd/business-rules/platform.feature`) — The `WatchConfig` stream still re-establishes without data loss. The wider catch must keep the gRPC-error reconnect.
- **PRESERVE** `@AC-3 @feature-171` "Telemetry init remains non-blocking after the trading_mode attribute is removed" (`docs/sdd/business-rules/platform.feature`) — Startup must not fail because of the task registry or done-callback.
- **PRESERVE** `@AC-4 @feature-210` (fail-closed mTLS boot) (`docs/sdd/business-rules/platform.feature`) — Boot and fail-closed semantics are unchanged.
- **EXTEND** none. The new AC-1..AC-8 add failure-survival cases alongside the guarantees above, and none of them
  alters an existing guarantee's observable outcome.
- **CHANGE** none identified. No existing `@AC-*` asserts the buggy behavior, namely that a loop dies on an
  unguarded exception or that a failed P&L event is skipped past the cursor.
- **Gap, not a rule:**
  - No suite pins the P&L consumer cursor, retry or park semantics. `order-snapshots-pnl-patterns.feature` has no
    such scenario.
  - No suite covers `ConfigWatcher` reconnect beyond `@AC-6 @feature-210`.
  - No suite covers task retention.
  - So FR-4/FR-5 (AC-6/AC-7) and FR-2/FR-3 (AC-4/AC-5/AC-8) are net-new durable rules for launch promotion (C-16).
- **Coverage note:** all three services have `acceptance/` suites. The suites named above were read; the
  remaining analysis suites were pattern-scanned, not read line by line. By title and grep they assert RPC
  outputs, not loop or cursor behavior.

## Dependencies

- Proto/RPC: none. The consumer still reads `ledger.v1 StreamEvents(from_sequence)` and the watchers still read
  `config.v1 WatchConfig`, both unchanged.
- Migration: none unless design picks a parked-events table for FR-5. In that case the next number is **`028`**
  for `services/xstockstrat-analysis/migrations/` (`028_<name>.up.sql` + `.down.sql`). Re-derive it against the
  merged tree at /sdd-spec (C-07), because batch peers 262 (`fix-analysis-owner-scope`), 260
  (`fix-fundsignal-emit-accounting`) and 272 (`fix-analysis-backtest-bounds`) may also add analysis migrations.
  The analysis `CLAUDE.md` mentions a "migration `028`" (feature 184) and "`027_analysis_readiness_materializer_keys`".
  Both are **config-service** seed migrations, not analysis ones, so they do not collide. A table would also need
  DBA review (Fix Scope).
- Config keys: none existing for loop backoff, watcher backoff or a consumer retry bound.
  - The only analysis retry and jitter keys are `analysis.fundsignal.retry_seconds`,
    `analysis.fundsignal.startup_jitter_seconds`, `analysis.opportunity.retry_seconds` and
    `analysis.opportunity.startup_jitter_seconds`.
  - The only consumer keys are `analysis.snapshot.*` and `analysis.patterns.*`.
  - Any new knob is `analysis.<category>.<key>` (C-05) with its default declared in the analysis `CLAUDE.md`. The
    watcher backoff cannot sensibly be a config key, since it is the client that delivers config.
- Inter-service edges: none new. analysis → ledger `StreamEvents` and {analysis, indicators, ingest} → config
  `WatchConfig` already exist.
- New env vars / ports: none.

## Risks / Not-found

- **Watcher reconnect duplicating snapshot state.** `_watch` sets `self._snapshot` / `self._snapshot_event` inside
  the stream loop. A wider `except` must reconnect the same single loop, not spawn a second `_watch`. The Node
  watcher's 2026-10-03 "stream doubling" defect (`69c8554`) is the recurrence shape to avoid.
- **Unguarded schedule `advance` on the error path.** `fundsignal_loop.py:155`, `servicer.py:5891` and `:6067` all
  call `advance` from the error branch. If that `advance` fails too, the schedule stays unadvanced (still due), and
  the loop's own backoff then decides when the retry runs.
  - The backoff must be a real sleep. A bare `continue` busy-spins against a down DB (`@AC-5 @feature-156`
    no-busy-spin).
  - The backoff must not replace `retry_seconds` as the cadence once the DB is back (`@AC-4 @feature-156`).
- **Benign exits vs unexpected exits.**
  - The three servicer `*_forever` methods return early when their repo or pool is `None` (`servicer.py:5917`,
    `:6088-6093`, `:6141`).
  - `_boot_recompute` (`main.py:143`) and `backfill_entry_times` (`:174`) are one-shots that complete normally.
  - A done-callback must not log these as errors. It should log only an exception, or a "forever" task that
    returns.
  - A cancellation at shutdown must not log as an unexpected exit either.
- **Done-callback must not break boot.** `@AC-3 @feature-171` / `@AC-4 @feature-210`: the retention helper must not
  raise during `serve()` start-up.
- **P&L retry vs the `sequence <= cursor` short-circuit.** `process_event` re-reads the cursor on every call
  (`:165-167`). Retrying the same event in place, before the `async for` takes the next one, preserves ordering. A
  reconnect-based retry works only if no later event has advanced the cursor.
- **Parking advances the cursor.** The park must record the event (sequence, event_id, reason) durably or in a
  structured `log.error`, before or atomically with `_advance_cursor`. Otherwise a crash between the two loses the
  record. This is the cursor-atomicity property in the analysis `CLAUDE.md`, which is prose and not an `@AC-*`.
- **Poison classifier vs handled degrades.** `@AC-17 @feature-225` (ownerless order → degraded snapshot) and
  FR-6 timeouts (partial snapshot) are successes, not exceptions. Only an exception escaping `process_event`
  counts as a failed attempt.
- **Retry must not double-emit.** `@AC-7 @feature-042`: the post-commit best-effort `analysis.snapshot.*` /
  `analysis.pattern.sealed` emits happen after the txn. A failure *after* commit is short-circuited on retry
  (`sequence <= cursor`), so no double-emit is expected. Design should state this explicitly.
- **Applicable `fails.md` traps:**
  - 2026-09-16 (192) duplication: copy-pasted watchers multiply bugs, and the fix must land in all three copies.
    Consolidation stays out of scope (D-20), so the spec must carry one identical step shape per service, with one
    test per copy.
  - Ledger fails.md:125 (feature 074): a test that constructs a live `ConfigWatcher` dials and retries forever.
    `__init__` opens `grpc.aio.secure_channel` and starts the task (`watcher.py:43-56`), so watcher tests must patch
    `grpc.aio.secure_channel` / `mtls` and the stub, and must bound the loop, or they hang.
  - Ledger insights 2026-08-25 (156): `instance_count: 1` means no lease or CAS machinery. A supervisor needs no
    cross-process fencing.
- **Overlaps** (from context.md; rebase or coordinate only, all line-disjoint today):
  - 244 edits the getters in all three `watcher.py` files and `retry_seconds` reads at `fundsignal_loop.py:143,154`
    and `servicer.py:5890,6066`.
  - 248 re-greps `pnl_pattern_consumer.py:147-162` (`await asyncio.sleep(2)`).
  - 246 and 260 edit `fundsignal_loop.py`.
  - 262 touches `main.py:174` and must reuse this feature's retention helper.
  - 268 touches indicators `tests/test_config_watcher.py`.
  - Peer **258** `fix-config-stream-resilience` is config/ledger **server-side** only. Its Out of Scope excludes
    the client-side Python watcher (D-08), so there is no file overlap; its server-side stream-close fix triggers
    the client reconnect path this feature widens.
- **Not found:**
  - No shared supervised-loop helper, task registry or `add_done_callback` use anywhere in the three services.
  - No exponential-backoff helper in the three Python services.
  - No parked-events or dead-letter table, no attempt counter, and no "poison" handling (judged by migration names
    001–027 and a grep).
  - No test drives `ConfigWatcher._watch`, `PnLPatternConsumer.run_forever`, `run_readiness_materializer_forever`
    or `run_template_intent_sweep_forever` under an injected exception.
  - The existing `test_config_watcher.py` files cover only `resolve_environment` / `resolve_trading_mode`
    (analysis, indicators) and the getters (ingest).
- **Out-of-scope siblings, noted for design and not to be silently absorbed (P-03):**
  - ingest `run_mcp_client_loop` unretained task at `app/main.py:127`. Ingest pollers are peer 261's area.
  - analysis fire-and-forget `create_task` sites in `servicer.py` (`:4242`, `:4821`, `:4845`, per discovery). These
    are not boot loops.

## Recommended Scope

Advisory step boundaries for /sdd-spec. Design forks to settle in the debate:

1. One shared supervised-loop helper or a per-loop `try`.
2. Where the retained task set lives (a module-level set in `main.py` or a small helper module).
3. The FR-5 park mechanism (a structured `log.error` or a migration-028 table) and the retry bound (3 in AC-7).
4. Whether backoffs and the bound are fixed invariants or config keys.

Proposed steps:

1. **analysis — task retention + done-callback (FR-2, AC-4).** Add a retained task set and a done-callback that
   logs the task name and the exception for an unexpected exit, ignoring one-shot completion, benign early returns
   and cancellation. Route all eight boot `create_task` sites in `main.py` through it. Paired test.
2. **analysis — loop survival (FR-1, AC-1..AC-3).** Guard the schedule seams in `FundamentalsSignalLoop.run_forever`
   / `_tick` (including the `_advance_schedule` call in `except`) and in the three servicer `*_forever` loops and
   their ticks. Use a real backoff sleep, and keep the `retry_seconds` cadence and early-return guards. Paired tests
   extend `test_fundsignal_loop.py`, `test_opportunity_refresh.py` and `test_readiness_materializer.py`, plus a
   sweep test.
3. **analysis — P&L retry + park (FR-4, FR-5, AC-6, AC-7).** Retry `process_event` in place up to the bound with
   backoff, then park (logged with sequence and event_id, plus the table if chosen) and `_advance_cursor`. Paired
   test with a fake `StreamEvents` on `FakeLedger`. Optional migration 028 step before it if a table is chosen.
4. **analysis / indicators / ingest — watcher reconnect + retention (FR-3, AC-5, AC-8).** One step per service, or
   one step with three identical edits: broaden `_watch`'s catch to `Exception` (cancellation propagates), add
   capped backoff, retain `self._watch_task` with a done-callback, and keep `_build_watch_request` identity. Paired
   watcher test per service, with the channel and stub patched.
5. **docs.** Update the analysis `CLAUDE.md` (new fixed invariants or keys; the P&L consumer park rule) and any
   context-constitution or findings entry touched, then run the teardown.
