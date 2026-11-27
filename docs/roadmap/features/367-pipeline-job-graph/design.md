# Design: pipeline-job-graph

**Created**: 2026-11-27
**Rounds**: 12 (full; round cap lifted by the operator; termination: pending operator approval)
**Approved by**: pending
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Internal only: no UI segment and no agent tool consumes this feature (product-spec § Consumer
Surface). Decision IDs refer to debate.md.

### Data model (D-1, D-10, D-23, D-24, D-27, D-38, D-59)

Analysis migration `031_pipeline_job_graph` creates two plain tables, disjoint from
`analysis.job_schedule` (`services/xstockstrat-analysis/migrations/020_job_schedule.up.sql:8-11`).

`analysis.pipeline_jobs`, `WITH (fillfactor = 70)`:

- Identity and key: `job_id BIGINT GENERATED ALWAYS AS IDENTITY` primary key; `kind`, `subject`,
  `epoch`, `run_id` (`TEXT NOT NULL`); unique index on `(kind, subject, epoch)`.
- Scheduling: `lane SMALLINT NOT NULL` with `CHECK (lane IN (10, 20))` (`watchlist` = 10, `held` =
  20); `state TEXT NOT NULL` with a `CHECK` over `ready`, `running`, `waiting`, `succeeded`,
  `failed`, `dead`, `blocked` (`failed`, `dead` and `blocked` are the terminal states; with
  `succeeded` they are the finished states); `attempts INT NOT NULL DEFAULT 0`;
  `wait_round SMALLINT NOT NULL DEFAULT 0`; `next_attempt_at TIMESTAMPTZ NOT NULL`.
- Lease: `lease_token UUID` (from `gen_random_uuid()`), `lease_expires_at TIMESTAMPTZ`.
- Outcome: `verdict`, `error_class` (`CHECK` in `transient`, `permanent`), `last_error` (truncated
  to 1 KB in the engine, no database length check), `created_at TIMESTAMPTZ NOT NULL DEFAULT
  now()`, `finished_at`. No result column.
- Checks: a row is `running` exactly when it has a lease token and expiry; `blocked` implies a
  verdict; a finished state implies `finished_at`, and only a finished state has one.
- Indexes: the unique key; `(state, lane DESC, next_attempt_at, job_id) WHERE state IN ('ready','running','waiting')`, so
  each claim, reap, settle and stats predicate on `state` implies it;
  `(state, finished_at)` over finished rows; `(run_id)`.

`analysis.pipeline_job_deps`: `(parent_id, child_id)` primary key, both referencing
`pipeline_jobs` with `ON DELETE CASCADE`, a no-self-edge check, and an index on `child_id`.

State transitions:

| From | To | Cause |
|---|---|---|
| — | `ready` | enqueue |
| `ready` | `running` | claim: `attempts + 1`, new lease token |
| `running` | `succeeded` / `failed` / `blocked` | report: success, permanent error, handler verdict |
| `running` | `ready` or `dead` | transient failure, or reaped expired lease; `dead` once `attempts` reaches `max_attempts` |
| `running` | `waiting` | park; the attempt is refunded |
| `waiting` | `ready` | settle: every child succeeded; `wait_round + 1` |
| `waiting` | `blocked` | settle: a child ended `failed`, `dead` or `blocked` (D-15) |

### Clocks, fencing and at-least-once (D-2, D-3, D-14, D-20, D-54)

The database clock decides lease expiry, next-attempt time, retention cutoffs and ready age. The
instance clock decides only the prune's UTC-date epoch and local timers. Every report is one statement fenced by `job_id`,
`lease_token` and `state = 'running'`; every park is one transaction whose first statement is
fenced the same way; zero rows means the report or park is rejected. Execution is at-least-once, so effects outside the fenced report must be idempotent.
Correctness rests on the fence and on idempotent effects alone; the local self-fence (a per-attempt timer that stops a running handler at its fence deadline, 3 s
before the lease it last renewed would expire; see Lease timing) only limits duplicate work. Expiry alone does not end a lease; a reap does. A heartbeat or report against an
expired lease that has not been reaped succeeds. A reap skips a row that a heartbeat, report or
park holds; one of those that waits on a reap's lock re-checks token and state on the new row
version and matches nothing.

### Bounded database access (D-16, D-17, D-29, D-36, D-51)

- **Two pools.** The service pool stays at 2 with `DB_POOL_MAX` unset
  (`app/main.py:55-62`). A second, control pool has fixed `max_size=2`, `min_size=0`, built by a
  shared helper in `main.py` that applies the same `statement_cache_size=0` rule under
  `DB_PGBOUNCER` (`app/main.py:59-61`). Its only users are the heartbeat task and one serialized control
  lane, so a client connection is always available. The lane lock is taken before the control-pool
  acquire and released after the connection is released or terminated; no retry or backoff sleep
  happens under it. No backend slot is added: pooled client
  connections are not backend slots (`docs/patterns/database.md:175-180`; F-06).
- **`bounded_txn`** in `app/repositories/read_budget.py`, beside the untouched `budgeted_read`:
  an explicit transaction opened with `BEGIN; SET LOCAL statement_timeout` as one query, with the
  timeout re-armed to the remaining budget before each statement (`read_budget.py:42-46`). The
  deadline is fixed at entry, before the pool acquire; the acquire timeout and the client timer
  are measured from it. A
  client timer terminates the connection at deadline + 2 s grace. The server timeout is what
  normally fires; the timer covers what the server cannot (a PgBouncer queue wait, a frozen
  backend, a lost socket).
- **Exit rules.** COMMIT's command tag is checked, and anything but `COMMIT` raises a transient
  error, so a transaction the server rolled back can never be recorded as success. On a server
  timeout or an exception from the block, `ROLLBACK` is sent while the client timer is still
  armed, and the connection is terminated if that fails. Under cancellation, expiry or abort, the
  connection is terminated with no rollback and no awaited release (`read_budget.py:79-99`); when
  the timer fired, the error raised is `DbBudgetExceeded`. A `terminated` flag, set by whoever
  terminates first, guards later cleanup, because asyncpg detaches a terminated pooled connection
  (`read_budget.py:100-107`). Signature: `bounded_txn(pool, budget_s, *,
  on_acquired=None, on_terminate=None)`. `on_acquired` is called synchronously when
  `pool.acquire` returns, before `BEGIN`. The handle exposes `fetch`, `fetchrow`, `fetchval`,
  `execute` and a synchronous, idempotent `abort()` that terminates the connection and sets
  `terminated`. `on_terminate` runs once, whoever terminates.
- **No asyncio cancellation bounds any database I/O.** No `asyncio.timeout` wraps a transaction.
  `pool.acquire(timeout=remaining budget)` bounds only the wait for a client connection, including
  a new connect under `min_size=0`, before any transaction is open.
- **Control pool reset.** The pool's `reset` callback sends no query and raises if a connection is
  released inside a transaction.
- **Budgets.** Control operations 5 s (effective 8 s with grace and release); heartbeat 3 s
  (effective 6 s); a handler block at most 30 s.

What this does not guarantee: one PgBouncer pool of 5 backends per database is shared by all six
pooled services (`docs/patterns/database.md:150-152,185`), so a control operation's `BEGIN` can
queue behind another service's transaction. Only the client timer bounds that wait. A missed
heartbeat costs duplicate work and one attempt, never a double-recorded result.

### Repository and SQL (D-4, D-5, D-18, D-22, D-30, D-35, D-38, D-41, D-44, D-49, D-52, D-55, D-56, D-57, D-58, D-59)

`PipelineJobsRepository` in `app/repositories/pipeline_jobs.py` follows the existing repository
shape (`app/repositories/opportunities.py:82-92`); every method takes `conn=None`. Without `conn`,
a method runs through the control lane lock and `bounded_txn(control_pool, 5 s)`; `heartbeat()`
uses `bounded_txn(control_pool, 3 s)` without the lane lock.

- **Enqueue:** insert with `ON CONFLICT (kind, subject, epoch) DO NOTHING` and
  `next_attempt_at = now()`; when nothing is inserted, return the existing job, which keeps its
  own `run_id` and lane. If a prune removed that row in between, the insert is retried once in the
  same transaction.
- **Claim:** `FOR NO KEY UPDATE SKIP LOCKED` over ready rows whose next-attempt time has passed,
  filtered to the kinds this process has handlers for, ordered `lane DESC, next_attempt_at, job_id`
  (shape: `services/xstockstrat-marketdata/internal/repository/profile_repo.go:250-257`). That
  lock conflicts with itself, so two claimers never take the same row, and it does not conflict
  with a park's `FOR KEY SHARE` on a ready child.
- **Reap:** expired `running` rows go to `ready` with `next_attempt_at = now()`, or to `dead` with
  `error_class = 'transient'` and `last_error = 'lease_expired'` once attempts are used up.
  Candidates are selected with `ORDER BY job_id FOR NO KEY UPDATE SKIP LOCKED`, so two instances
  never block or deadlock each other and a park's `FOR KEY SHARE` on a child does not hide it; the outer update re-checks the state and the expiry. A reap does
  not increment `attempts`. Reap has no `LIMIT`; its candidates are the expired `running` rows, at
  most the slots of the instances that claimed them plus the jobs of claims whose
  acknowledgement was lost.
- **Heartbeat:** one batched update of the leases this instance holds, fenced by `job_id`,
  `lease_token` and `state = 'running'` with no expiry test, returning the renewed pairs.
- **Report:** one fenced statement; the target state is computed in SQL.
- **Park:** one transaction of fixed length: fence and lock the parent `FOR NO KEY UPDATE`
  (compatible with another park's `FOR KEY SHARE` on it as a child), insert children with
  `ON CONFLICT (kind, subject, epoch) DO NOTHING`, lock children by key `FOR KEY SHARE`, insert
  edges with `ON CONFLICT (parent_id, child_id) DO NOTHING` (re-declaring a child, including one
  from an earlier round, is harmless), set `waiting`. A new child takes the parent's `run_id`
  and, unless the handler names one, its lane. When the child lock returns fewer rows than the
  deduplicated children (a concurrent prune deleted one), the park raises `ParkRace` before
  inserting edges: the runner re-runs the park on the report retry schedule and under the same
  300 s give-up; the handler is not re-run and no attempt is consumed.
- **Settle:** wakes or blocks parents whose children are all finished or include a failure, 500
  per batch, selected with `ORDER BY job_id FOR NO KEY UPDATE SKIP LOCKED`. A batch is one UPDATE
  statement: the candidate subquery and the target state and verdict are evaluated under that
  statement's single snapshot. Shape: `UPDATE pipeline_jobs j SET … WHERE j.job_id IN (SELECT
  job_id … ORDER BY job_id LIMIT 500 FOR NO KEY UPDATE SKIP LOCKED) RETURNING j.job_id`; the
  outer UPDATE adds no predicate, so the rows returned are the rows the candidate select locked.
  The settleable
  predicate is inside the candidate subquery, before `LIMIT`; a batch is full when that select
  returns 500 rows. Each batch is its own lane operation, queued at the tail. Settle repeats
  while a batch is full; the check is made before queueing for the next batch, and it stops once
  20 batches have run or 8 s have passed since the settle step began. A failed child gives `dependency_failed`, a dead child `dependency_dead`, a
  blocked child its own verdict; among the children in `failed`, `dead` or `blocked`, the one with
  the lowest `job_id` decides. A wake sets `next_attempt_at = now()`. Settle transitions are not
  attempts and are not counted.
- **Prune:** one DELETE loop per finished state (four in all), each with a single cutoff
  timestamp, in batches of 500. A batch is two statements in one transaction: an unordered
  candidate `SELECT j.job_id FROM pipeline_jobs j … FOR UPDATE OF j SKIP LOCKED LIMIT 500` whose
  unfinished-parent guard, before `LIMIT`, is `NOT EXISTS (SELECT 1 FROM pipeline_job_deps d JOIN
  pipeline_jobs p ON p.job_id = d.parent_id WHERE d.child_id = j.job_id AND p.state NOT IN
  ('succeeded','failed','dead','blocked'))` (a sublink, so neither edges nor parents are
  locked), then `DELETE … WHERE job_id = ANY(<locked ids>)` that repeats the guard.
  The DELETE's snapshot is taken after the locks are held, so it sees every edge committed before
  them, and a park that reaches a locked row waits for the batch; if the row was deleted, the
  park raises `ParkRace`, or, if its child insert ran after the delete, inserts a fresh child. Locked rows that fail the repeated guard are kept. Terminal states are
  pruned before `succeeded`, so a succeeded backlog cannot starve them. A loop ends when the
  candidate select returns fewer than 500 rows. The cutoffs are read once per DELETE loop. Every
  candidate select in this repository locks only the outer `pipeline_jobs` alias, and any guard or
  predicate over another table is an `EXISTS` / `NOT EXISTS` subquery, which takes no row locks.
- **List by run:** `job_id, kind, subject, epoch, lane, state` for one `run_id`, ordered by
  `job_id`, on the `(run_id)` index; no caller in this feature besides tests.
- **Ready stats per lane:** over rows with `state = 'ready' AND next_attempt_at <= now()`, depth is
  the count and age is `now() − min(next_attempt_at)`. Jobs in backoff are not backlog.

### Worker runtime (D-6 to D-9, D-19, D-21, D-28, D-31, D-32, D-37, D-43, D-46, D-48 to D-54, D-57, D-58)

`app/engine/job_graph.py` holds the settings reader, lanes, outcomes, classifier, backoff, attempt
and worker. Handlers live in `app/jobs/`. The worker takes its handler registry as a constructor
argument; `main.py` passes the `app/jobs/` registry, and tests pass their own (for example a
`probe` kind). Three tasks start through `supervision.spawn`
(`app/supervision.py:16`; after `app/main.py:228`). Each database step is guarded on its own;
`run_supervised`'s 30 s backoff (`app/supervision.py:55-68`) is only the net for bugs.

- **Claim loop.** Blocks on a `ResizableLimiter` over `worker_concurrency`
  (`app/config/live_limits.py:12,27-36`) while the instance is full, claims as many jobs as it has
  free slots, and starts one runner per job. The next delay is 0 when every free slot was filled,
  `poll_interval_ms` when the claim returned some jobs but fewer than the free slots, and after an
  empty claim it doubles up to `max(poll_interval_ms, 5 s)`. Free slots are taken by repeated
  `acquire()` while `in_use < limit`; unused ones are released after the claim; `cfg.on_change`
  wakes the limiter (`app/handlers/servicer.py:544-547`). `live_limits.py` is not edited.
  `worker_enabled` is read again after the limiter returns and again after the control lane is
  taken, immediately before the claim transaction; if it is false, the lane and the taken slots
  are released, no statement is issued and the tick returns 5 s. Taken slots are also released
  when the claim transaction fails.
- **Maintenance loop** (the tick returns 5 s − elapsed, at least 0). Each tick runs reap, then
  settle, then the daily prune ensure, then stats every third tick, each in its own transaction.
  `worker_enabled` is read again before each step and before queueing each settle batch. The
  in-memory "ensured for this UTC day" marker is set only after a committed ensure.
- **Heartbeat loop** (fixed period 7.5 s, whatever `lease_seconds` is). An in-flight attempt is
  keyed by its `(job_id, lease_token)` pair and removes only its own key. One batched renewal of
  attempts in phase `running` or `retry_wait`; an empty set issues no statement. It leaves out
  attempts that are reporting or were stopped as lost or self-fenced; an attempt stopped at the
  900 s deadline stays in the batch until its report is written or it is abandoned at the 10 s
  stop grace. A runner takes the control lane
  lock first and only then becomes `reporting`; until then it stays in the batch. Holding the
  lane, and before acquiring a connection, it waits for an in-flight batch that contains its key
  (at most the heartbeat's effective 6 s), so the heartbeat never contends with its own
  instance's row lock. A batch is in flight from the synchronous step that snapshots its keys,
  which also registers it, until its `bounded_txn` exits by commit, rollback, termination or
  exception; completion is signalled in a `finally`. The runner becomes `reporting` and checks
  for an in-flight batch in one synchronous step after taking the lane, and bounds its wait with
  its own 6 s timer (an event wait, no database I/O). Loss is declared only from a result whose
  COMMIT returned the tag `COMMIT` and which omits the pair. A committed result that omits the key
  of an attempt already `reporting` declares no loss; the runner's report and the fence decide.
  When its 6 s timer fires before the batch completes, the runner proceeds; the late result
  declares no loss for it, and any row-lock contention ends at the report's own statement timeout.
  If the lease was in fact lost, the fence rejects the report and `report_rejected` is counted. `lease_seconds` is read once per tick and that value sets both the SQL
  expiry and the fence. The tick returns 7.5 s − elapsed, at least 0.
- **Handler contract.** `async (ClaimedJob) -> Succeeded | WaitOn | Verdict`. Only
  `PermanentJobError` is permanent; any other exception is transient; a non-outcome return is a
  permanent failure. `ClaimedJob.wait_round` tells the handler its stage, and a woken parent may
  assume every declared child succeeded. Backoff is `min(5·2^(attempt−1), 300)` s plus up to 20 %
  jitter.
- **Runner.** Runner and handler tasks start through `supervision.spawn(..., forever=False)`. The
  handler runs in an engine wrapper that catches `Exception` and `AttemptStopped` and returns an
  outcome, so handler failures do not reach `supervision`'s ERROR log
  (`app/supervision.py:27-33`); `CancelledError` propagates. The runner then writes the report or
  park itself and is never cancelled.
  - *Retry and give-up.* A failed report is retried (1, 2, 4 … 30 s) while the attempt stays
    heartbeated, until it succeeds, is rejected by the fence, or the 300 s give-up passes. The
    give-up is measured from the end of the handler task. It is checked before each queueing for
    the lane, when the lane is granted, and before each retry sleep, which is cut to the time
    left; a try already started is never interrupted (at most 14 s). At the give-up the runner
    logs the last report error at ERROR (or that no try was made), counts
    `lease_events{report_abandoned}` once, drops the key, and the lease expires. An attempt
    already lost counts nothing at the give-up. `last_error` is truncated in the engine to 1 KB of UTF-8.
  - *After the handler ends.* The self-fence and the 900 s deadline stop only an attempt whose
    handler task is still running: "still running" is `not handler_task.done()` when the timer
    fires, both timers are cancelled in the handler task's done-callback, and a timer callback
    that finds the task done does nothing. Once the handler task has ended, whether the attempt
    is waiting for the lane, `reporting` or in `retry_wait`, it only writes the fenced report or
    park. It ends when that is written or rejected, at the give-up, or when a committed heartbeat
    omits its pair while it is not `reporting`. That loss is recorded on the attempt, which then
    leaves the heartbeat set, writes nothing and counts `lease_events{lost_heartbeat}` once; a
    retry sleep is an event wait that the loss ends early, and an attempt waiting for the lane
    releases it as soon as it is granted, with no statement issued.
  - *Park parity.* Everything said of a report applies to a park: a fenced-out park counts
    `report_rejected`, and a `ParkRace` is a failed try.
  - *Slot.* The limiter slot is released by a done-callback on the runner task (shape:
    `app/config/live_limits.py:67-72`). The runner ends only after the handler task has ended and
    its report or park is written, rejected or abandoned, or dropped after a loss or self-fence,
    so a slot counts an attempt that can still use the control lane. After its handler ends an
    attempt therefore holds its slot at most 300 s plus one lane wait, or 314 s when a try was
    already started; under a report outage an instance stops claiming for that long.
- **Stop path.** A stop is a lost lease, the self-fence, or the 900 s attempt deadline; the latter
  two apply only while the handler task runs. The attempt records the stage of its current
  database block: `gate`, `acquire` or `txn`; the stage becomes `txn` synchronously when the pool
  acquire returns. A stop terminates the connection when the stage is `txn` and cancels the
  handler task otherwise, so no cancellation is ever delivered inside a transaction. Stops are
  requested from timer and heartbeat callbacks on the event loop, never from another thread. If the pool
  acquire returns even though a stop was requested during it, the block terminates the connection
  at once and raises `AttemptStopped`. A handler task that ends cancelled after a stop is treated
  as having returned that stop's outcome. Once a stop is pending, or the fence deadline has
  passed, the handler cannot open a new database block.
  - *Lost lease or self-fence.* The runner writes no report or park: it waits for the handler
    task and drops its key. After a self-fence the lease then expires and the reaper counts the
    attempt `expired`; after a lost lease the reap that took it has already counted it. A
    lost-lease or self-fence stop replaces a pending deadline stop; a deadline stop never
    replaces either. The first of a lost lease or a self-fence counts
    `lease_events{lost_heartbeat}` or `{lost_self_fence}` once; a later one changes nothing.
  - *Deadline.* A handler that ends within 10 s of a deadline stop that no later stop replaced is
    reported with the outcome it returned, or as a transient `attempt_timeout` if it ended
    cancelled or with `AttemptStopped`.
  - *Unresponsive handler.* A handler still running 10 s after any stop is logged at ERROR and
    counted `handler_abandoned`, gets no heartbeat and no report, and keeps its slot until its
    task ends; its lease expires and the reaper counts the attempt `expired`.
- **Disabled worker.** Claims, the daily ensure and maintenance stop at the next tick and issue no
  statements. A tick that reads `worker_enabled` false at any check issues no further statement,
  writes the `disabled` record (claim loop) and returns 5 s. A claim transaction already sent
  when the flag changes completes. The stats step stops too, so the ready gauges report nothing
  within 45 s after the worker is disabled. Jobs already running keep their
  heartbeat and write their result. While every instance is disabled no expired lease is reaped.
- **Shutdown.** No lease is released; in-flight leases expire.

### Dependencies (D-15, D-23, D-35)

A handler returns `WaitOn(children)`. Before the park, children are deduplicated and sorted; there
must be 1 to 10 000, never the parent's own key, and each child kind must be declared in the parent
kind's `child_kinds`. The handler registry rejects a cyclic kind graph at boot, so no two parents
can wait on each other. Park rounds are capped at 8. A larger fan-in is staged across rounds. A
key repeated with two lanes keeps the higher one. A `WaitOn` that fails these checks, or that is
returned when `wait_round` is already 8, and a `Verdict` with an empty label, are permanent
failures (`failed`, with `last_error` naming the check); no park is attempted.

### Handler database contract (D-33)

`async with job.db(budget) as conn` is a handler's only database access: the service pool, behind
a per-instance gate of one, inside `bounded_txn`. Repositories called from a handler take `conn=`;
nothing else is awaited inside the block; writes are idempotent. The job graph therefore holds at
most one service-pool connection at a time.

The gate wait is bounded by `asyncio.timeout(budget)`; it does no I/O. The gate is released at
most once, and only if it was acquired: a per-block flag set on acquisition is cleared by
whichever comes first, block exit, a stop's abort, or the transaction's expiry (through
`on_terminate`). A stop while the block waits for the gate cancels the wait and releases nothing.
A `job.db(budget)` with a budget outside (0, 30] s raises `PermanentJobError` at block entry,
before the gate. A refused block (stop pending or fence deadline passed) raises
`AttemptStopped`. `PermanentJobError` subclasses `Exception`; the wrapper turns it into `failed`. `AttemptStopped` subclasses `BaseException`.

`tests/test_job_handler_contract.py` parses `app/jobs/` and fails on any of:

- `asyncpg` imports, any `.acquire(` call, or the names `db_pool` / `control_pool`;
- imports from `app.repositories.read_budget`, or of the job repository other than its prune
  batch method;
- catching `BaseException`, `CancelledError` or `AttemptStopped`, or a bare `except:`;
- `asyncio.shield`, or `asyncio.timeout` / `wait_for` around a `.db(` block;
- inside a `job.db()` block, an await that is neither a call on the block's `conn` nor a call
  passing `conn=`.

### Lease timing (D-34, D-47, D-48, D-51)

Fixed: heartbeat period 7.5 s, self-fence margin 3 s, tolerated event-loop lag 2 s.
`lease_seconds` is bounded `[45, 600]`. At the floor a holder survives two consecutive failed
renewals and a pooler stall of 26 s; at the default of 60, four and 41 s. These hold from a
holder's first renewal on. A claim acknowledged up to 7 s after it was sent delays that renewal,
so until then the figures are two renewals and 19 s at 45, three and 34 s at 60.

The send time is recorded before the transaction's `BEGIN` is sent, so it precedes the `now()`
the lease is computed from. Only when the COMMIT is acknowledged
and returns the pair does the attempt's fence deadline become that send time + `lease_seconds` −
3 s; a failed batch leaves it unchanged. A claim reads `lease_seconds` once; each claimed
attempt's fence deadline is the claim's send time + that value − 3 s. Timer lateness beyond 2 s
is logged.

A job whose worker stopped is claimable again within `lease_seconds` + 10 s, plus up to 4 s of
event-loop lag, while the database answers normally (70 s at defaults, 74 s with lag). This needs an enabled
instance with that job kind registered and a free slot.

No closed-form worst case is stated. Takeover is bounded by client timers through these
invariants, each testable with a fake clock:

- The control lane is FIFO with at most (slots held + 2) operations queued: runners holding a
  slot, the claim loop and the maintenance loop. Slots held is at most `worker_concurrency`,
  except that after a runtime decrease runners already holding slots keep them until they end, so
  never more than 16.
- A lane operation lasts at most 8 s; a runner's at most 14 s, including its wait for an in-flight
  heartbeat batch.
- A maintenance tick issues at most 3 lane operations besides settle (reap, ensure, stats; the
  enqueue retry runs in the ensure's transaction) and at most 20 settle batches, queueing none
  once 8 s have passed since settle began.
- The idle claim delay is at most 5 s.

This is the bound the product spec's lease constraint refers to: a takeover waits at most for
lease expiry, the rest of the current maintenance tick, one maintenance period plus lag, one reap,
the idle claim delay plus lag, and one claim; each term is bounded by the invariants above. The
invariants are tested with a fake connection and a virtual-time event loop.

The worst case is therefore linear in `worker_concurrency`. It is measured by
`db.duration{phase=wait}` and `oldest_ready_age`, not tested in CI. Any other caller of a
repository method without `conn=` adds to the lane queue and voids the bound.

### Retention prune (D-38, D-45, D-50, D-58, D-59, D-60; product-spec FR-7)

Kind `pipeline.retention_prune`, subject `global`, epoch the UTC date, `run_id`
`retention_prune:<UTC date>`, lane `watchlist`. Each
instance ensures the day's job on its first maintenance pass of the UTC day and after a restart.
The handler deletes succeeded rows older than `retention_days`, and `failed`, `dead` and `blocked`
rows older than `max(30, retention_days)` days, each batch in its own `job.db()` block with a
30 s budget, through
the repository's prune batch method with `conn=`. Rows skipped because they are locked wait for
the next day. The handler stops starting batches after 600 s and returns success, so a large
backlog is spread over days and never ends `dead` on the attempt deadline.

Manual recovery, documented in `services/xstockstrat-analysis/docs/pipeline-jobs.md` until program
feature 4 adds a requeue. Every statement, the edge delete included, is guarded by the job id and
the expected state, so a repeated or concurrent run changes nothing once the row has moved.

For a `failed` or `dead` job:

```sql
UPDATE analysis.pipeline_jobs
   SET state = 'ready', attempts = 0, next_attempt_at = now(), finished_at = NULL,
       verdict = NULL, error_class = NULL, last_error = NULL
 WHERE job_id = <id> AND state = '<failed|dead>';
```

For a `blocked` job (a parent, or a job blocked by its own handler's verdict, whose edge delete
removes only edges from earlier rounds, if any), run the following in one transaction. The lock
holds the row in `blocked` until commit without blocking a concurrent park that names it as a
child. If the `SELECT` returns no row, `ROLLBACK` and stop. If the transaction fails, for example
on a deadlock with the daily prune, run it again; every statement is guarded, so a re-run is safe:

```sql
BEGIN;
SELECT job_id FROM analysis.pipeline_jobs
 WHERE job_id = <id> AND state = 'blocked' FOR NO KEY UPDATE;
DELETE FROM analysis.pipeline_job_deps
 WHERE parent_id = <id>
   AND EXISTS (SELECT 1 FROM analysis.pipeline_jobs WHERE job_id = <id> AND state = 'blocked');
UPDATE analysis.pipeline_jobs
   SET state = 'ready', attempts = 0, wait_round = 0, next_attempt_at = now(), finished_at = NULL,
       verdict = NULL, error_class = NULL, last_error = NULL
 WHERE job_id = <id> AND state = 'blocked';
COMMIT;
```

Recover bottom-up: a `failed` or `dead` job before the jobs that wait on it, and a `blocked` job
before the `blocked` jobs that wait on it. A parent recovered before its child re-declares the
child, finds it still failed or blocked, and is blocked again. Requeuing a job does not unblock
jobs already `blocked` on it. Find them through `pipeline_job_deps` (`child_id = <id>`, then
upward), not through the verdict, which names no child. A job's incoming edges survive its own
recovery, so walk upward one level at a time, recovering each `blocked` parent with the `blocked`-job SQL above. Start each walk at least 10 s
after the recovery commits, so a settle that read the job as `blocked` before the commit has
finished. A recovered `failed` or `dead` job keeps its `wait_round` and edges and re-runs its
current stage, as a transient retry does; a recovered `blocked` job restarts at round 0.

The same page names what to watch and how to read it:

- `loop tick ok loop=pipeline_worker`: absent for over 60 s while enabled means every slot is held
  or the claim loop is dead.
- `lease_events{outcome=handler_abandoned}` and `attempts{outcome=dead}`.
- `oldest_ready_age` and `ready_depth`: absent means the worker is disabled or stats are failing,
  not an empty queue.

It gives a "job not running" checklist: state, `next_attempt_at`, `lease_expires_at`,
`last_error`, children through `pipeline_job_deps`, `worker_enabled`, and whether the kind is
registered. It says that `worker_enabled = false` stops claims, the ensure and reaping, so
`running` rows past expiry are expected until it is re-enabled, while running jobs finish (up to
900 s). And it says that an instance whose slots are all held by unresponsive handlers needs a
restart.

### Config (D-12, D-25, D-36)

`JobGraphSettings` reads the six keys fresh at each use with literal key strings
(`app/config/watcher.py:72`; `app/config/watch_core.py:223`), clamps the int keys to their bounds
and logs one WARN per distinct clamped value.

| Key (`analysis.pipeline.*`) | Default | Bounds |
|---|---|---|
| `worker_enabled` | `true` | — |
| `worker_concurrency` | 4 | `[1, 16]` |
| `poll_interval_ms` | 1000 | `[200, 5000]` |
| `lease_seconds` | 60 | `[45, 600]` |
| `max_attempts` | 5 | `[2, 20]` |
| `retention_days` | 7 | `[1, 90]` |

Config migration `060_analysis_pipeline_keys`, the `SCALAR_BOUNDS_REGISTRY` rows
(`services/xstockstrat-config/src/grpc/configServiceImpl.ts:115`), the reader, the two
`scripts/config-wiring.json` receivers, the regenerated stored set, the five int keys in `FR3_KEYS` of
`tests/test_config_read_classification.py:25-63` (each also a literal in another test,
`:233-238`) and the docs rows land in one step and one commit.

### Telemetry (D-11, D-26, D-39, D-40)

- Loop name `pipeline_worker` (6 of 8 used), written by the claim loop at most once per 60 s: no
  state after a claim that returned jobs, `idle` after an empty claim, `disabled` when disabled;
  nothing while it is blocked on a full limiter.
- `analysis.pipeline.attempts{outcome}`: `succeeded|parked|blocked|retried|failed|dead|expired`,
  counted once by whoever writes the transition out of `running`; the reaper counts `expired` and
  `dead`.
- `analysis.pipeline.lease_events{outcome}`:
  `lost_heartbeat|lost_self_fence|report_rejected|report_abandoned|handler_abandoned`.
- Histogram `analysis.pipeline.db.duration` (seconds) with `step` in
  `heartbeat|claim|reap|settle|ensure|stats|report|park|handler`, `phase` in `wait|total`, and
  `outcome` in `ok|error|timeout` on `phase=total`. The label keys are added as `KEY_LANE`,
  `KEY_STEP` and `KEY_PHASE` in `app/telemetry.py`, from which `tests/test_telemetry_allowlist.py:16`
  derives its allow-list; the new instruments join that test's `MIN_INSTRUMENTS` and `_drive()`,
  and the loop name is `Loop.PIPELINE_WORKER`. `phase=wait` runs from requesting the control lane
  (for `heartbeat`, the pool; for `handler`, the gate) until the pool acquire returns;
  `phase=total` runs from that request until the transaction exits. Buckets:
  `[0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]`.
- Gauges `analysis.pipeline.ready_depth{lane}` and `oldest_ready_age{lane}`, through the `Gauge`
  wrapper (`app/telemetry.py:365-397`), extended so `observe()` may return a list of
  `(value, attributes)` pairs while a scalar return keeps today's behaviour, registered in `main.py` after
  `init_telemetry()` (`app/main.py:41`). The snapshot is refreshed with the stats step; one older
  than 45 s reports nothing.
- No alert ships in this feature.

### Build order (D-13)

1. Config seed, bounds, settings reader, wiring and docs rows (one step).
2. Analysis migration `031`.
3. `bounded_txn`, the repository, and the real-Postgres tests that pin the asyncpg behaviour the
   design relies on.
4. Engine: outcomes, classifier, backoff, attempt, stop path, the three loops, `app/jobs/` registry.
5. Retention-prune handler.
6. Telemetry.
7. `main.py` wiring.
8. Docs: root `CLAUDE.md` pool row, `docs/patterns/database.md`, analysis `CLAUDE.md`,
   `services/xstockstrat-analysis/docs/pipeline-jobs.md` (manual recovery SQL), and the correction
   of `docs/roadmap/program-job-graph-analysis-pipeline.md` line 81. The root `CLAUDE.md` analysis
   row reads "service 2 (`DB_POOL_MAX` unset) + pipeline control 2 (fixed, not env-overridable);
   client connections to PgBouncer, not backend slots". The analysis `CLAUDE.md` sentence "Reuses
   the existing asyncpg pool (no new pool — budget stays 2)" is amended.

Real-Postgres tests use `local_pg` and the `real_pg` marker. Database time is moved by rewriting
time columns, never by sleeping; process time comes from injected `monotonic` and `utc_today`.

Step 3's real-Postgres tests gate step 4:

- a statement over budget is cancelled by the server and the connection is reused;
- a frozen backend is cut at budget + 2 s and the pool recovers;
- cancellation inside an open transaction terminates without a rollback;
- a COMMIT that returns `ROLLBACK` raises;
- cancelling during a pool acquire returns the connection, and two later acquires succeed;
- releasing a control connection issues no query, and raises when it is in a transaction;
- a park with a repeated key succeeds; two overlapping parks in opposite order do not deadlock;
- a park whose parent is a new or existing child of a concurrent park of its own parent kind
  neither waits nor deadlocks;
- the prune batch's DELETE keeps a row with an edge from an unfinished parent committed after the
  ids were chosen: the test selects the ids without a lock, commits a park that re-declares that
  finished child, locks the ids `FOR UPDATE`, then runs the batch's DELETE statement on them; the
  row and its edge survive. A park started after an open batch's candidate select but before its
  DELETE waits on the child lock and raises `ParkRace`, and its re-run inserts the child afresh
  and leaves the parent `waiting` with every edge present. A park started after the DELETE waits
  on the unique check and inserts the child afresh;
- a `blocked`-job recovery run a second time, after the parent was re-claimed and parked
  again, deletes no edge and updates no row; a park naming a `blocked` row as a child is not
  blocked by an open recovery transaction on it;
- a 10 000-child park plus its settle finishes within 5 s;
- 1 200 settleable parents are woken in one tick with the lowest-id verdict;
- each prune candidate select uses the `(state, finished_at)` index, and the claim select the
  unfinished-rows index, on a seeded table; with `retention_days` = 7, a `dead` row aged 8 days
  survives;
- a runner that waited for an in-flight heartbeat batch records no false loss;
- a waiting parent held `FOR KEY SHARE` by another parent's open park is still settled, and a
  ready child held the same way is still claimed;
- two instances running reap and settle on the same rows neither block nor deadlock.

Already pinned in the repo: a terminated pooled connection frees its pool slot
(`services/xstockstrat-analysis/tests/test_read_budget_real_pg.py:148-164`).

Step 4's unit tests include: a stop inside a database block aborts it and raises
`AttemptStopped`; a new block is refused after a stop; an unresponsive handler keeps its slot
until its task ends; an attempt retrying its report keeps its slot; a claim loop blocked on a
full limiter when the worker is disabled claims nothing once the slot is freed; a job claimed right after
`lease_seconds` is lowered is renewed before its fence; a disabled worker lets a running job
report; the claim delay sequence; the lane invariants of the lease-timing section on a fake clock;
the clamp WARN fires once per changed value; the contract test.

Fixed constants, recorded invariants and not config keys: control budget 5 s; heartbeat budget
3 s; heartbeat period 7.5 s; handler block cap 30 s; prune self-stop 600 s; grace 2 s; release
bound 1 s; maintenance period 5 s; self-fence
margin 3 s; tolerated lag 2 s; attempt deadline 900 s; stop grace 10 s; report give-up 300 s;
park rounds 8; children per park 10 000; settle batch 500, at most 20 batches or 8 s per tick;
prune batch 500 with a 30 s block budget; stats every third maintenance tick (15 s), stale after
45 s; idle claim ceiling 5 s; report retry 1, 2, 4 … 30 s; claim acknowledgement window 7 s.

## Rejected Alternatives

- `R-1` Advisory locks for mutual exclusion — row locks plus token fencing already give it.
- `R-2` `LISTEN`/`NOTIFY` wake-ups — unavailable through PgBouncer transaction mode.
- `R-3` One metric name per lane — breaks the per-lane series.
- `R-4` A third maintenance lane — the spec defines two.
- `R-5` Releasing leases at shutdown — database I/O inside a cancellation handler.
- `R-6` Claim taking expired leases directly — loses the expired-attempt count.
- `R-7` A sequence fencing token as fallback — not needed on PG16/PG18.
- `R-8` `is_transient_db_error` as the classifier — a transient allow-list is a recorded misuse.
- `R-9` One in-process lock for all job-graph SQL on the service pool — unbounded wait starves
  heartbeats.
- `R-10` A single control connection with a priority scheduler — saves no backend slot, adds a
  scheduler.
- `R-11` Raising `DB_POOL_MAX` and partitioning with semaphores — RPC paths would still starve
  control operations.
- `R-12` Waking a parent inside its child's report as the only mechanism — two last children can
  miss each other.
- `R-13` asyncpg's client-side `timeout=` cancel — unproven through PgBouncer.
- `R-14` Deferring a stop until the handler leaves its database block — the cancel can land in the
  next transaction.
- `R-15` A result column or a child-state read — no reader.
- `R-16` Merging maintenance steps into one transaction — a settle error would stop every reap.
- `R-17` Releasing an unresponsive handler's slot — live handlers could exceed the bound.
- `R-18` Matching method names in the contract test — too broad.

## Open Risks

- [ ] asyncpg 0.31 behaviour not yet pinned: terminate wakes an in-flight await;
  `create_pool(reset=…)`; `min_size=0`. The step-3 tests pin them before step 4. Fallbacks, so no
  decision is left for the build: if terminate does not wake the await, `bounded_txn` awaits each
  statement as a child task raced against the timer with `asyncio.wait`, terminates on expiry and
  stops awaiting the task, whose exception a done-callback retrieves (the task is held in a
  module-level set until it ends and is not started through `spawn`); without `reset=`, drop it
  and pay one round trip; without `min_size=0`, use 1 (one idle client connection, no backend
  slot).
- [ ] PgBouncer queueing cannot be tested in CI; a frozen backend stands in for it. To be measured
  through `db.duration{phase=wait}` in program feature 3's shadow run.
- [ ] Tolerated event-loop lag of 2 s is a design tolerance. Timer lateness is logged; revisit the
  lease floor if it is exceeded.
- [ ] A report that committed but whose acknowledgement was lost is under-counted once in
  `attempts`, and the attempt then counts a spurious `report_rejected` (on its retry) or
  `lost_heartbeat` (if a heartbeat commits first). Accepted.
- [ ] A claim that committed but whose acknowledgement was lost leaves its jobs `running` under
  tokens no instance holds; each costs one attempt and waits for lease expiry and the reap.
- [ ] A backlog of terminal rows larger than 600 s per day delays the `succeeded` prune.
- [ ] Throughput: one control lane and one handler gate per instance. To be measured in program
  feature 3's shadow run: attempts per second against the slope of `ready_depth`; handler gate
  wait p95 (revisit above 1 s); heartbeat duration p99 (revisit above 1.5 s); claim and report
  duration p99; settle duration p95 (above 100 ms, or more than 10 000 waiting parents, adopt a
  child-driven settle alongside the sweep); dead-tuple ratio on `pipeline_jobs` (above 0.2, set
  per-table autovacuum).
- [ ] Until program feature 4 adds a requeue, a `dead` or `failed` key blocks parents on the same
  key for that epoch; recovery is the manual SQL in `pipeline-jobs.md`.
- [ ] Same-kind dependencies are impossible under the kind DAG. A dynamic cycle check in park is
  the named relaxation.
- [ ] Hazards H1 and H2 (D-33) apply to any later in-transaction report. To be carried into
  program feature 3's design.
- [ ] A heartbeat batch already in flight when a self-fence fires can still commit and extend
  that lease once, so such a job is claimable up to `lease_seconds` + 6 s after the self-fence
  fired, not about 3 s after.
- [ ] A report that fails deterministically re-runs the job until it ends `dead` with
  `last_error = 'lease_expired'`; the cause is only in the ERROR log.
- [ ] A handler that crashes the process is re-run at once on the next instance, up to
  `max_attempts` times.
- [ ] Under a report outage an instance stops claiming for up to 300 s plus one lane wait, or
  314 s when a try was already started, after its handlers end (the slot is held until the report is written or abandoned).
- [ ] An unresponsive handler holds its slot until its task ends; when every slot is held that way
  the instance stops claiming until it is restarted. The contract test forbids the handler code
  that most directly causes it, not library code that suppresses cancellation.
- [ ] A handler that runs work in an executor thread frees its slot on cancellation while the
  thread keeps running. Not forbidden here, because evaluation handlers will need executors; to be
  designed in program feature 3.
- [ ] A job of a kind no running instance registers stays `ready` and pins the ready gauges;
  retiring a kind means draining or deleting its rows.
- [ ] A prune that fails deterministically goes `dead` each day and nothing prunes; visible only
  as `attempts{outcome=dead}`. One cause: a batch's cost
  grows with the edges its rows cascade; a wide parent deleted before its children in an unordered
  `succeeded` batch can exceed the 30 s block, and the batch rolls back whole.
- [ ] Reversing a `child_kinds` edge between two code versions could create a wait cycle during a
  deploy overlap; each instance checks only its own registry.
- [ ] A report still unacknowledged after 300 s re-runs completed work after the lease expires.
- [ ] No alert ships; the watch list lives in `pipeline-jobs.md`.

## Constitution Rules Touched

- `C-05` — honored by: six namespace-relative keys, each seeded and read, declared in the product
  spec.
- `C-07` — honored by: analysis `031`, config `060`, each the next free number.
- `C-08` — honored by: paired test steps; real-Postgres tests for the SQL; analysis threshold 40.
- `C-13` — honored by: job-row fixtures in `services/xstockstrat-analysis/tests/conftest.py`.
- `C-14` — honored by: consumer surface None, justified in the product spec.
- `C-15` — honored by: every FR covered by `@AC-1` to `@AC-18`.
- `C-16` — honored by: no existing scenario changes; see below.
- `C-18` — honored by: one report method, one histogram, no result column, no requeue, no
  advisory locks; each remaining mechanism guards a named guarantee.
- `F-01` — honored by: new migrations only.
- `F-06` — honored by: no direct pool raised; `DB_POOL_MAX` unset; the control pool adds client
  connections behind PgBouncer, not backend slots; budget docs updated.
- `F-07` — honored by: tunables are config keys; fixed timing constants are recorded invariants,
  the established practice (`app/supervision.py:9-10`).
- `P-03` — honored by: the program plan's advisory-lock note is corrected, not silently dropped.
- `C-10` — honored by: step 1 lands every config surface (seed, bounds registry, reader, wiring,
  read-classification rows, docs) in one commit; step 8 updates every pool-budget document.
- `C-03`, `C-04`, `C-09`, `C-12`, `C-17` — not touched: no outbound RPC, no proto, no UI.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @AC-2 @AC-3 @AC-7 @AC-8 @AC-9 @feature-158`
  (`services/xstockstrat-analysis/acceptance/durable-loop-scheduler.feature`) — not regressed by:
  separate tables; `DurableSchedule` is not imported.
- PRESERVE `@AC-1 @AC-2 @AC-3 @AC-6 @AC-7 @AC-9 @AC-10 @feature-259`
  (`services/xstockstrat-analysis/acceptance/fix-python-loop-supervision.feature`) — not regressed
  by: no existing loop or the P&L consumer is changed.
- EXTEND `@AC-4 @feature-259` — new case added: the three pipeline tasks start through `spawn`.
- EXTEND `@AC-1 @AC-4 @AC-6 @feature-244` (`docs/sdd/business-rules/platform.feature`) — new case
  added: the five int keys read through `int_positive`.
- EXTEND `@AC-14 @feature-295`
  (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`) — new case added: six
  keys seeded in both environments.
- PRESERVE `@AC-1 @feature-296`, `@AC-6 @AC-24 @feature-296`, `@AC-1 @AC-2 @AC-3 @feature-278`,
  `@AC-13 @AC-19 @feature-295` — not regressed by: relative stored keys, a reader per seed.
- PRESERVE `@AC-7 @feature-294` — not regressed by: one new loop name (6 of 8), no identifiers in
  attributes.
- EXTEND `@AC-3 @feature-337` — new case added: the new instruments carry `host.provider`.
- PRESERVE `@AC-4 @feature-176` — not regressed by: the job graph holds at most one service-pool
  connection, for at most 30 s plus the 2 s grace and the 1 s release.
- PRESERVE `@AC-2 @feature-274` — not regressed by: no RPC changes.
