# Product Spec: pipeline-job-graph

**Created**: 2026-11-27

---

## Problem Statement

The analysis service runs its periodic work as in-process timer loops whose unit of work is a whole
tick, whose progress lives in memory, and which each reinvent scheduling, retry and claiming. The
program plan (`docs/roadmap/program-job-graph-analysis-pipeline.md`) traces about 35 bug reports to
that shape. The operator needs one durable, multi-instance-safe job mechanism that later features
can move those loops onto.

## User Story

As the platform operator, I want a durable Postgres-backed job graph and worker runtime inside
`xstockstrat-analysis`, so that later features can replace the in-process analysis loops with
per-item jobs.

## Functional Requirements

FR-1. **Idempotent keyed enqueue.** A job is identified by (kind, subject, epoch). Enqueuing an
existing key creates no second job and reports the existing one.

FR-2. **Fenced leases.** A worker claims a job under a lease that it extends by heartbeat. A lease
that is not extended expires and the job becomes claimable by another worker. A worker that lost
its lease cannot record a result. A takeover after lease expiry counts as a new attempt.
Correctness must not depend on a single service instance.

FR-3. **Classified retries.** A handler failure is classified transient or permanent. A transient
failure is retried no sooner than 5 seconds after it failed, up to `analysis.pipeline.max_attempts`
attempts, then the job ends in state `dead`. A permanent failure ends the job at once in state
`failed`. An error the classifier does not recognise is treated as transient. How the delay grows
with the attempt number is a design output.

FR-4. **Park-and-wake dependencies.** A job can declare that it waits on other jobs. It is not
claimable while any of them is unfinished, and becomes ready when they succeed. When one of them
ends with a terminal unsatisfiable verdict, the waiting job ends blocked with that verdict and does
not run again. A verdict is an opaque label set by the handler; `no_vendor_data` in `@AC-9` is an
example value, not a job kind this feature ships.

FR-5. **Priority lanes.** Each job has a lane. A ready job in a higher lane is claimed before a
ready job in a lower lane, whatever their enqueue order. This feature defines two lanes, `held`
above `watchlist`; the full lane set is a design output. The prune job runs in the lowest lane.

FR-6. **Universe-run id.** Each job carries the id of the universe run that created it, and a
run's jobs can be listed with their states through the job repository. No RPC exposes this.

FR-7. **Retention, run as the first job kind.** Succeeded jobs that finished more than
`analysis.pipeline.retention_days` days ago are deleted, after which the key can be enqueued again,
so job kinds use epochs that never recur. Jobs that ended `failed`, `dead` or `blocked` are kept
for `max(30, retention_days)` days, then deleted. A job that an unfinished job waits on is never
deleted. The prune is a job on the graph, kind `pipeline.retention_prune`, one per UTC day. Every
instance with the worker enabled ensures the day's job through the idempotent enqueue (FR-1) on its
first maintenance pass of each UTC day and after each restart, so it runs once however many
instances are up. It is the core's only production job kind in this feature (operator decisions,
2026-11-27).

FR-8. **Telemetry.** The runtime exports ready depth and oldest-ready age per lane, plus counts of
attempts by outcome.

FR-9. **Kill switch, no behavior change.** With `analysis.pipeline.worker_enabled` false, no job
is claimed and no prune job is enqueued. The worker is on by default so that the prune (FR-7)
exercises the core in production. This feature moves no existing loop and changes no RPC response.
A job already running when the worker is disabled keeps its lease and records its result.
Disabling stops new claims, the daily ensure and the maintenance pass at the next tick. While every
instance is disabled, no expired lease is reaped.

## Out of Scope

- Moving any loop onto the job graph (program features 2 to 4).
- Any job kind with pipeline meaning (data fetch, evaluation, backfill). The retention prune
  (FR-7) is the only production job kind.
- A broker or any new infrastructure component (operator decision D-1).
- A job mechanism in Go or Node services; marketdata and ingest stay RPC servers.
- An outbox for alerts and ledger events (program feature 3).
- Raising the analysis instance count (program feature 8). This feature only makes it safe.
- A UI or agent view of the queue.

## Affected Services

Exact service names from CLAUDE.md Service Registry:

- `xstockstrat-analysis` — owns the job tables, the worker runtime and the telemetry.
- `xstockstrat-config` — seeds the new `analysis` config keys.

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI**
- [ ] **Agent**
- [x] **None** — internal platform mechanism. It is consumed only by later analysis job handlers
  inside the same service, and FR-9 requires that no end-user response changes. Operators observe
  it through the existing telemetry export (FR-8).

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

All keys are in namespace `analysis`, stored namespace-relative as `pipeline.<key>`, read fresh at
each use through the service's `WatchConfig` watcher (PLAT-6). The reader for every key is
`services/xstockstrat-analysis/app/engine/job_graph.py:JobGraphSettings`, **to be created** by this
feature (the name is the story's proposal; `/sdd-design` may move it). Integer keys are read through
the existing `services/xstockstrat-analysis/app/config/watcher.py:int_positive`. Seed migration:
`services/xstockstrat-config/migrations/060_analysis_pipeline_keys` (`059` is the latest today;
re-check the number at `/sdd-spec` and `/sdd-execute`).

- `analysis.pipeline.worker_enabled` — bool, code default `true`. Kill switch for claiming and for the daily prune enqueue (FR-9).
- `analysis.pipeline.worker_concurrency` — int, code default `4`. Jobs one instance runs at once.
- `analysis.pipeline.poll_interval_ms` — int, code default `1000`. Delay between claim polls while claims are finding jobs and slots are free; when idle, polling backs off to `max(poll_interval_ms, 5000)` ms.
- `analysis.pipeline.lease_seconds` — int, code default `60`. Lease length without a heartbeat (FR-2).
- `analysis.pipeline.max_attempts` — int, code default `5`. Attempts before dead-letter (FR-3).
- `analysis.pipeline.retention_days` — int, code default `7`. Age at which succeeded jobs are pruned (FR-7).

## Database Changes

New tables in the `analysis` schema for jobs and for dependency edges between jobs, with the
indexes the claim query needs. One migration pair, `031` in
`services/xstockstrat-analysis/migrations/` (`030` is the latest today; re-check at `/sdd-spec`),
applied in the existing analysis slot of `scripts/db-migrate.sh`. Table and column names are a
design output.

Constraint: analysis reaches Postgres through PgBouncer in transaction mode
(`docs/patterns/database.md` § Connection pooling). `LISTEN`/`NOTIFY` and session advisory locks
are unavailable; `FOR UPDATE SKIP LOCKED` and transaction-scoped advisory locks work.

## Feature Workflow Notes

Branch to create: `feature/pipeline-job-graph` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Design Constraints

Inputs the design must satisfy. They are not open questions: each states what `/sdd-design` has to
show.

- **Lease reversal.** Features 156 and 158 rejected leases because a lease taken before a crash
  wedged the schedule for the full hold (`docs/roadmap/ledger/insights.md`, 2026-08-26). Operator
  decision D-11 reverses that ruling. The design must show that heartbeat expiry bounds the wedge.
  A job whose worker died becomes claimable again within `lease_seconds` + 10 s while the database
  answers normally, and within a bound stated in the design if every database operation runs to
  its timeout. Both require an instance with the worker enabled, that job kind and a free slot.
- **Poison handling.** The ledger records events lost when a consumer skipped a failure and
  advanced (`fails.md`, fix-offline-book-consistency) and a transient allow-list misused as the
  park classifier (fix-python-loop-supervision). No failure path may end in silent success (FR-3).
- **Connection budget (F-06).** Analysis has a 2-connection client pool behind a PgBouncer pool of
  5, with `DB_POOL_MAX` unset. The design must show how `worker_concurrency` 4 and the heartbeats
  fit that pool without raising a direct pool.
- **Existing scheduler.** `analysis.job_schedule` and `DurableSchedule` (feature 158) stay untouched
  and keep driving the existing loops. The design must state that the two mechanisms are disjoint.
- **Worker placement.** The worker runs inside the analysis service process in this feature. A
  separate deployed component is a question for program feature 8.
- **Per-subject serialization.** Not required. Only uniqueness per (kind, subject, epoch) is
  (FR-1). The design must not add it without a requirement.
- **Unused capability (C-18).** Lanes and dependency edges (FR-4, FR-5) have no production consumer
  until program features 2 and 3. They are in scope because the program plan fixes them as the
  core contract; the design adversary should test that.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **A core with no consumer.** Resolved 2026-11-27: the operator chose to make the retention
  prune the first real job kind (FR-7), so the core runs in production from this feature on.
- [x] **Worker default.** Resolved 2026-11-27: the operator confirmed
  `analysis.pipeline.worker_enabled` defaults to `true`, so the prune runs with no operator step.
