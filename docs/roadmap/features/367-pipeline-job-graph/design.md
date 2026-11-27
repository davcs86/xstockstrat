# Design: pipeline-job-graph

**Created**: 2026-11-27
**Rounds**: 3 (full; termination: pending operator approval)
**Approved by**: pending
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Internal only: no UI segment and no agent tool consumes this feature (product-spec § Consumer
Surface). Decision IDs refer to debate.md.

### Data model (D-1, D-10, D-23, D-24, D-27, D-38)

Analysis migration `031_pipeline_job_graph` creates two plain tables, disjoint from
`analysis.job_schedule` (`services/xstockstrat-analysis/migrations/020_job_schedule.up.sql:8-11`).

`analysis.pipeline_jobs`, `WITH (fillfactor = 70)`:

- Identity and key: `job_id BIGINT GENERATED ALWAYS AS IDENTITY` primary key; `kind`, `subject`,
  `epoch`, `run_id` (`TEXT NOT NULL`); unique index on `(kind, subject, epoch)`.
- Scheduling: `lane SMALLINT` with `CHECK (lane IN (10, 20))` (`watchlist` = 10, `held` = 20);
  `state` in `ready`, `running`, `waiting`, `succeeded`, `failed`, `dead`, `blocked`;
  `attempts INT`; `wait_round SMALLINT`; `next_attempt_at TIMESTAMPTZ`.
- Lease: `lease_token UUID`, `lease_expires_at TIMESTAMPTZ`.
- Outcome: `verdict`, `error_class` (`transient` or `permanent`), `last_error` (1 KB),
  `created_at`, `finished_at`. No result column.
- Checks: a row is `running` exactly when it has a lease token and expiry; `blocked` implies a
  verdict; a finished state implies `finished_at`, and only a finished state has one.
- Indexes: the unique key; `(state, lane DESC, next_attempt_at, job_id)` over unfinished rows;
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

### Clocks, fencing and at-least-once (D-2, D-3, D-14, D-20)

The database clock decides lease expiry, next-attempt time, retention cutoffs and ready age. The
instance clock decides only the prune's UTC-date epoch and local timers. Every result write is one
statement fenced by `job_id`, `lease_token` and `state = 'running'`; zero rows means the report is
rejected. Execution is at-least-once, so effects outside the fenced report must be idempotent.
Correctness rests on the fence and on idempotent effects alone; the local self-fence only limits
duplicate work.

### Bounded database access (D-16, D-17, D-29, D-36)

- **Two pools.** The service pool stays at 2 with `DB_POOL_MAX` unset
  (`app/main.py:55-62`). A second, control pool has fixed `max_size=2`, `min_size=0`, built by a
  shared helper in `main.py`. Its only users are the heartbeat task and one serialized control
  lane, so a client connection is always available. No backend slot is added: pooled client
  connections are not backend slots (`docs/patterns/database.md:175-180`; F-06).
- **`bounded_txn`** in `app/repositories/read_budget.py`, beside the untouched `budgeted_read`:
  an explicit transaction opened with `BEGIN; SET LOCAL statement_timeout` as one query, with the
  timeout re-armed to the remaining budget before each statement (`read_budget.py:42-46`). A
  client timer terminates the connection at deadline + 2 s grace. The server timeout is what
  normally fires; the timer covers what the server cannot (a PgBouncer queue wait, a frozen
  backend, a lost socket).
- **Exit rules.** COMMIT's command tag is checked, and anything but `COMMIT` raises a transient
  error, so a transaction the server rolled back can never be recorded as success. Under
  cancellation, expiry or abort, the connection is terminated with no rollback and no awaited
  release (`read_budget.py:79-99`). A `terminated` flag guards later cleanup, because asyncpg
  detaches a terminated pooled connection (`read_budget.py:100-107`).
- **No asyncio cancellation bounds any database I/O.** No `asyncio.timeout` wraps a transaction.
- **Control pool reset.** The pool's `reset` callback sends no query and raises if a connection is
  released inside a transaction.
- **Budgets.** Control operations 5 s (effective 8 s with grace and release); heartbeat 3 s
  (effective 6 s); a handler block at most 30 s.

What this does not guarantee: one PgBouncer pool of 5 backends per database is shared by all six
pooled services (`docs/patterns/database.md:150-152,185`), so a control operation's `BEGIN` can
queue behind another service's transaction. Only the client timer bounds that wait. A missed
heartbeat costs duplicate work and one attempt, never a double-recorded result.

### Repository and SQL (D-4, D-5, D-18, D-22, D-30, D-35, D-38)

`PipelineJobsRepository` in `app/repositories/pipeline_jobs.py` follows the existing repository
shape (`app/repositories/opportunities.py:82-92`); every method takes `conn=None`.

- **Enqueue:** insert with `ON CONFLICT (kind, subject, epoch) DO NOTHING`; when nothing is
  inserted, return the existing job.
- **Claim:** `FOR UPDATE SKIP LOCKED` over ready rows whose next-attempt time has passed, filtered
  to the kinds this process has handlers for, ordered `lane DESC, next_attempt_at, job_id`
  (shape: `services/xstockstrat-marketdata/internal/repository/profile_repo.go:250-257`).
- **Reap:** expired `running` rows go to `ready`, or `dead` once attempts are used up. The outer
  update re-checks the state and the expiry. A reap does not count an attempt.
- **Heartbeat:** one batched update of the leases this instance holds, returning the renewed pairs.
- **Report:** one fenced statement; the target state is computed in SQL.
- **Park:** one transaction of fixed length: fence and lock the parent, insert children, lock
  children `FOR KEY SHARE`, insert edges, set `waiting`. A child deleted by a concurrent prune
  makes the park retry.
- **Settle:** wakes or blocks parents whose children are all finished or include a failure, 500
  per batch, repeating while a batch is full (at most 20 batches per tick). The verdict comes from
  the failed child with the lowest id.
- **Prune:** one unordered DELETE per finished state with a constant cutoff, in batches of 500
  with `SKIP LOCKED`, never deleting a child of an unfinished parent.
- **List by run** and **ready stats per lane**.

### Worker runtime (D-6 to D-9, D-19, D-21, D-28, D-31, D-32, D-37)

`app/engine/job_graph.py` holds the settings reader, lanes, outcomes, classifier, backoff, attempt
and worker. Handlers live in `app/jobs/`. Three tasks start through `supervision.spawn`
(`app/supervision.py:16`; after `app/main.py:228`). Each database step is guarded on its own;
`run_supervised`'s 30 s backoff (`app/supervision.py:55-68`) is only the net for bugs.

- **Claim loop.** Blocks on a `ResizableLimiter` over `worker_concurrency`
  (`app/config/live_limits.py:12,27-36`) while the instance is full, claims as many jobs as it has
  free slots, and starts one runner per job. After an empty claim the delay doubles up to
  `max(poll_interval_ms, 5 s)`; a claim that returns a job resets it.
- **Maintenance loop** (every 5 s). Reap, settle, the daily prune ensure and stats, each in its own
  transaction.
- **Heartbeat loop** (every lease/6). One batched renewal. It skips attempts that are reporting or
  already stopped. A runner about to report waits for an in-flight batch that contains its key, so
  the heartbeat never contends with its own instance's row lock. Loss is declared only from a
  committed result that omits the pair.
- **Handler contract.** `async (ClaimedJob) -> Succeeded | WaitOn | Verdict`. Only
  `PermanentJobError` is permanent; any other exception is transient; a non-outcome return is a
  permanent failure. `ClaimedJob.wait_round` tells the handler its stage, and a woken parent may
  assume every declared child succeeded. Backoff is `min(5·2^(attempt−1), 300)` s plus up to 20 %
  jitter.
- **Runner.** Runs the handler in a wrapper that turns exceptions into outcomes, then writes the
  report or park itself. It is never cancelled. A failed report is retried (1, 2, 4 … 30 s) while
  the attempt stays heartbeated, until it succeeds, is rejected by the fence, or 300 s pass.
- **Stop path.** A stop (lease lost, self-fence, 900 s attempt deadline) terminates the handler's
  connection if it is inside a database block, and cancels the handler task otherwise. No
  cancellation is ever delivered inside a transaction. Once a stop is pending the handler cannot
  open a new database block. A handler still running 10 s after a stop is logged at ERROR and
  counted, gets no heartbeat and no report, and keeps its slot until its task ends.
- **Disabled worker.** Claims, the daily ensure and maintenance stop at the next tick and issue no
  statements. Jobs already running keep their heartbeat and write their result.
- **Shutdown.** No lease is released; in-flight leases expire.

### Dependencies (D-15, D-23, D-35)

A handler returns `WaitOn(children)`. Before the park, children are deduplicated and sorted; there
must be 1 to 10 000, never the parent's own key, and each child kind must be declared in the parent
kind's `child_kinds`. The handler registry rejects a cyclic kind graph at boot, so no two parents
can wait on each other. Park rounds are capped at 8. A larger fan-in is staged across rounds.

### Handler database contract (D-33)

`async with job.db(budget) as conn` is a handler's only database access: the service pool, behind
a per-instance gate of one, inside `bounded_txn`. Repositories called from a handler take `conn=`;
nothing else is awaited inside the block; writes are idempotent. The job graph therefore holds at
most one service-pool connection at a time. `tests/test_job_handler_contract.py` parses
`app/jobs/` and fails on a violation.

### Lease timing (D-34)

Fixed: heartbeat period lease/6, self-fence margin 3 s, tolerated event-loop lag 2 s.
`lease_seconds` is bounded `[45, 600]`. At the floor a holder survives two consecutive failed
renewals and a pooler stall of 26 s; at the default of 60, three and 39 s.

A job whose worker stopped is claimable again within `lease_seconds` + 10 s while the database
answers normally (70 s at defaults), and within `lease_seconds` + 14 + 16 × (`worker_concurrency`
+ 2) s if every operation runs to its timeout (170 s at defaults). Both need an enabled instance
with that job kind registered and a free slot.

### Retention prune (D-38; product-spec FR-7)

Kind `pipeline.retention_prune`, subject `global`, epoch the UTC date, lane `watchlist`. Each
instance ensures the day's job on its first maintenance pass of the UTC day and after a restart.
The handler deletes succeeded rows older than `retention_days`, and `failed`, `dead` and `blocked`
rows older than `max(30, retention_days)` days, each batch in its own `job.db()` block.

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
`scripts/config-wiring.json` receivers, the regenerated stored set, the config read-classification
test rows and the docs rows land in one step and one commit.

### Telemetry (D-11, D-26, D-39, D-40)

- Loop name `pipeline_worker` (6 of 8 used).
- Counters `analysis.pipeline.attempts{outcome}` and `analysis.pipeline.lease_events{outcome}`.
- Histogram `analysis.pipeline.db.duration{step, phase, outcome}` with explicit buckets.
- Gauges `analysis.pipeline.ready_depth{lane}` and `oldest_ready_age{lane}`, through a small
  extension of the `Gauge` wrapper (`app/telemetry.py:365-397`), registered in `main.py` after
  `init_telemetry()` (`app/main.py:41`). They report nothing when their snapshot is stale.

### Build order

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
   of `docs/roadmap/program-job-graph-analysis-pipeline.md` line 81.

Step 3's tests gate step 4: a statement over budget is cancelled by the server and the connection
reused; a frozen backend is cut at budget + 2 s and the pool recovers; cancellation inside an open
transaction terminates without a rollback; a COMMIT that returns `ROLLBACK` raises.

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

- [ ] asyncpg 0.31 behaviour could not be read in the design environment (terminate wakes an
  in-flight await; a terminated pooled connection frees its slot; `create_pool(reset=…)`;
  `min_size=0`). To be pinned by the step-3 tests before step 4. Fallback for `reset=`: drop it and
  pay one round trip.
- [ ] PgBouncer queueing cannot be tested in CI; a frozen backend stands in for it. To be measured
  through `db.duration{phase=wait}` in program feature 3's shadow run.
- [ ] Tolerated event-loop lag of 2 s is a design tolerance. Timer lateness is logged; revisit the
  lease floor if it is exceeded.
- [ ] A report that committed but whose acknowledgement was lost is under-counted once in
  `attempts`. Accepted.
- [ ] Throughput: one control lane and one handler gate per instance. Measurements and thresholds
  are named (D-40) for program feature 3.
- [ ] Until program feature 4 adds a requeue, a `dead` or `failed` key blocks parents on the same
  key for that epoch; recovery is the manual SQL in `pipeline-jobs.md`.
- [ ] Same-kind dependencies are impossible under the kind DAG. A dynamic cycle check in park is
  the named relaxation.
- [ ] Hazards H1 and H2 (D-33) apply to any later in-transaction report. To be carried into
  program feature 3's design.
- [ ] An unresponsive handler holds its slot until its task ends; at `worker_concurrency` 1 that
  stops the instance's claims. The contract test forbids the code that causes it.

## Constitution Rules Touched

- `C-05` — honored by: six namespace-relative keys, each seeded and read, declared in the product
  spec.
- `C-07` — honored by: analysis `031`, config `060`, each the next free number.
- `C-08` — honored by: paired test steps; real-Postgres tests for the SQL; analysis threshold 40.
- `C-13` — honored by: job-row fixtures in `services/xstockstrat-analysis/tests/conftest.py`.
- `C-14` — honored by: consumer surface None, justified in the product spec.
- `C-15` — honored by: every FR covered by `@AC-1` to `@AC-17`.
- `C-16` — honored by: no existing scenario changes; see below.
- `C-18` — honored by: one report method, one histogram, no result column, no requeue, no
  advisory locks; each remaining mechanism guards a named guarantee.
- `F-01` — honored by: new migrations only.
- `F-06` — honored by: no direct pool raised; `DB_POOL_MAX` unset; the control pool adds client
  connections behind PgBouncer, not backend slots; budget docs updated.
- `F-07` — honored by: tunables are config keys; fixed timing constants are recorded invariants,
  the established practice (`app/supervision.py:9-10`).
- `P-03` — honored by: the program plan's advisory-lock note is corrected, not silently dropped.

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
  connection, for at most 30 s.
- PRESERVE `@AC-2 @feature-274` — not regressed by: no RPC changes.
