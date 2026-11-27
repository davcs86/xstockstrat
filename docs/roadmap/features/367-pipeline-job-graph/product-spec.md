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
its lease cannot record a result. Correctness must not depend on a single service instance.

FR-3. **Classified retries.** A handler failure is classified transient or permanent. A transient
failure is retried after a delay, up to `analysis.pipeline.max_attempts`, then the job ends in a
dead-letter state. A permanent failure ends the job at once.

FR-4. **Park-and-wake dependencies.** A job can declare that it waits on other jobs. It is not
claimable while any of them is unfinished, and becomes ready when they succeed. When one of them
ends with a terminal unsatisfiable verdict, the waiting job ends blocked with that verdict and does
not run again.

FR-5. **Priority lanes.** Each job has a lane. A ready job in a higher lane is claimed before a
ready job in a lower lane, whatever their enqueue order.

FR-6. **Universe-run id.** Each job carries the id of the universe run that created it, and a
run's jobs can be listed with their states.

FR-7. **Retention.** Succeeded jobs older than `analysis.pipeline.retention_days` are deleted.
Dead and blocked jobs are kept for inspection.

FR-8. **Telemetry.** The runtime exports ready depth and oldest-ready age per lane, plus counts of
attempts by outcome.

FR-9. **Off by default, no behavior change.** With `analysis.pipeline.worker_enabled` false, no job
is claimed. This feature moves no existing loop and changes no RPC response.

## Out of Scope

- Moving any loop onto the job graph (program features 2 to 4).
- Any job kind with pipeline meaning (data fetch, evaluation, backfill).
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
each use through the service's `WatchConfig` watcher (PLAT-6). The reader `path:symbol` for each
key does not exist yet and is fixed at `/sdd-spec`. One config seed migration, the next free number
in `services/xstockstrat-config/migrations/` at spec time (`059` is the latest today).

- `analysis.pipeline.worker_enabled` — bool, code default `false`. Gates all claiming (FR-9).
- `analysis.pipeline.worker_concurrency` — int, code default `4`. Jobs one instance runs at once.
- `analysis.pipeline.poll_interval_ms` — int, code default `1000`. Delay between claim polls.
- `analysis.pipeline.lease_seconds` — int, code default `60`. Lease length without a heartbeat (FR-2).
- `analysis.pipeline.max_attempts` — int, code default `5`. Attempts before dead-letter (FR-3).
- `analysis.pipeline.retention_days` — int, code default `7`. Age at which succeeded jobs are pruned (FR-7).

## Database Changes

New tables in the `analysis` schema for jobs and for dependency edges between jobs, with the
indexes the claim query needs. One migration pair, the next free number in
`services/xstockstrat-analysis/migrations/` at spec time (`030` is the latest today). Table and
column names are a design output.

Constraint: analysis reaches Postgres through PgBouncer in transaction mode
(`docs/patterns/database.md` § Connection pooling). `LISTEN`/`NOTIFY` and session advisory locks
are unavailable; `FOR UPDATE SKIP LOCKED` and transaction-scoped advisory locks work.

## Feature Workflow Notes

Branch to create: `feature/pipeline-job-graph` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):

- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [x] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **A core with no consumer.** FR-9 means nothing uses the job graph when this feature ships.
  The "minimum that solves the stated problem" rule and C-18 will challenge that as speculative.
  Options: (a) keep the split and prove the core with test-only job kinds; (b) make the retention
  prune (FR-7) the first real job kind, so the core runs itself in production; (c) merge this
  feature with program feature 2 so the core ships with its first pipeline consumer. Operator to
  choose before `/sdd-design`.
- [ ] **Known trap — the lease reversal.** Features 156 and 158 rejected leases because a lease
  taken before a crash wedged the schedule for the full hold (`docs/roadmap/ledger/insights.md`,
  2026-08-26). Operator decision D-11 reverses that ruling. The design must show how heartbeat
  expiry bounds the wedge to `analysis.pipeline.lease_seconds`.
- [ ] **Known trap — poison handling.** The ledger records events lost when a consumer skipped a
  failure and advanced (`fails.md`, fix-offline-book-consistency) and a transient allow-list
  misused as the park classifier (fix-python-loop-supervision). FR-3's classifier must default an
  unknown error to transient-then-dead, never to silent success.
- [ ] **Known trap — connection budget (F-06).** Analysis has a 2-connection client pool behind a
  PgBouncer pool of 5. The design must state how `worker_concurrency` 4 fits that pool, including
  heartbeats.
- [ ] **Worker placement.** Does the worker run inside the analysis service process or as a
  separate deployed component? Deferred to design; program feature 8 depends on the answer.
- [ ] **Per-subject serialization.** Is "at most one running job per subject" needed in the core,
  or only uniqueness per (kind, subject, epoch)? No requirement asks for it today.
