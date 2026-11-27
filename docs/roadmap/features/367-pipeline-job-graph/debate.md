# Debate Register: pipeline-job-graph

**State**: in-debate
**Mode**: full (round cap lifted by operator override, context.md 2026-11-27)
**Rounds run**: 1

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-27 | /sdd-design | 15 | 8 | 0 | 19 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Two new tables, `analysis.pipeline_jobs` and `analysis.pipeline_job_deps`, in analysis migration `031`, behind one repository `app/repositories/pipeline_jobs.py`. Nothing is shared with `analysis.job_schedule` or `DurableSchedule`. | `services/xstockstrat-analysis/migrations/020_job_schedule.up.sql:8-11`; `app/repositories/opportunities.py:82-92` | settled |
| D-2 | 1 | The database clock (`now()`) decides lease expiry, next-attempt time, retention cutoff and ready age. The instance clock decides only the prune's UTC-date epoch label and the local self-fence deadline. | recon "Instance clocks"; `app/engine/durable_schedule.py:20,25,52` | settled |
| D-3 | 1 | Fencing uses a per-claim `lease_token UUID` from `gen_random_uuid()`. Every result write is one `UPDATE … WHERE job_id=$1 AND lease_token=$2 AND state='running'`; zero rows means rejected. | `.do/app.yaml:702` (PG18); `services/xstockstrat-identity/migrations/001_identity_tables.up.sql:7` | settled |
| D-4 | 1 | Claim is `FOR UPDATE SKIP LOCKED`, ordered `lane DESC, next_attempt_at, job_id`, and filtered to the kinds this process has handlers for (deploy-overlap safety). | `services/xstockstrat-marketdata/internal/repository/profile_repo.go:250-257`; `docs/patterns/database.md:140-142` | settled |
| D-5 | 1 | Expired leases are reaped by a separate statement (to `ready`, or `dead` once attempts are used up), so recovered jobs pass through the same lane-ordered claim. A reap does not increment `attempts`; the claim does. | `@AC-3` | settled |
| D-6 | 1 | Handler contract: `async (ClaimedJob) -> Succeeded \| WaitOn \| Verdict`. Only `PermanentJobError` is permanent; any other exception is transient; a non-outcome return value is a permanent failure, never implicit success. | `app/engine/pnl_pattern_consumer.py:63-77`; FR-3 | settled |
| D-7 | 1 | Backoff is `min(5·2^(attempt-1), 300)` seconds plus add-only jitter in `[0, 20%)`. These are fixed invariants in code, not config keys. | `app/supervision.py:9-10`; `@AC-5` | settled |
| D-8 | 1 | The worker runs inside the analysis process, started through `supervision.spawn`. No lease is released at shutdown; in-flight leases expire. | `app/supervision.py:16`; `app/main.py:228`; ANALYSIS-15 | settled |
| D-9 | 1 | The handler concurrency bound is a `ResizableLimiter` over `pipeline.worker_concurrency`, woken through `cfg.on_change`. | `app/config/live_limits.py:12,42`; `app/handlers/servicer.py:544-547`; PLAT-16 | settled |
| D-10 | 1 | Lanes are `SMALLINT` values `held=20`, `watchlist=10` with a `CHECK`; adding a lane is a migration. The prune job runs in `watchlist`, the lowest lane. | product-spec FR-5 | settled |
| D-11 | 1 | Telemetry: one new loop name `pipeline_worker` (6 of 8); an attempts counter keyed by `KEY_OUTCOME`; per-lane `ready_depth` and `oldest_ready_age` gauges with a new `KEY_LANE` attribute, via a small extension of the `Gauge` wrapper to return attributed observations. | `app/telemetry.py:365-397,404,423`; `@AC-7 @feature-294` | settled |
| D-12 | 1 | Config: `JobGraphSettings` in `app/engine/job_graph.py`, literal key strings at each `int_positive` / `get_bool` call, read fresh at each use; seed migration `060_analysis_pipeline_keys`; `SCALAR_BOUNDS_REGISTRY` entries for the five int keys; two `scripts/config-wiring.json` receivers. | `app/config/watcher.py:72`; `app/config/watch_core.py:223`; `scripts/config-wiring.json:78-93`; PLAT-6, PLAT-14 | settled |
| D-13 | 1 | Tests: the claim, lease, fencing, park, settle and prune SQL run against real Postgres (`local_pg`, `real_pg` marker). Database time is controlled by rewriting time columns, never by sleeping. Process time is controlled by injected `monotonic` and `utc_today`. | `tests/conftest.py:439`; `tests/test_read_budget_real_pg.py:25-28` | settled |
| D-14 | 1 | Execution is at-least-once. Handler side effects outside the fenced report must be idempotent. | FR-2 | settled |
| D-15 | 1 | A child that ends `failed` or `dead` blocks its waiting parent with verdict `dependency_failed` / `dependency_dead`; a child that ends `blocked` passes its own verdict up. A parent never waits forever on a terminal child. | FR-4; `@AC-9` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Transaction-scoped advisory locks for mutual exclusion (the 311 pattern the program plan named). | Redundant: `SKIP LOCKED` row locks plus token fencing already give exclusion. This overturns the note in `docs/roadmap/program-job-graph-analysis-pipeline.md:81`; the plan is to be corrected (P-03). | locked |
| R-2 | 1 | `LISTEN`/`NOTIFY` wake-ups. | Unavailable through PgBouncer transaction mode (`docs/patterns/database.md:160-172`). | locked |
| R-3 | 1 | One metric name per lane in place of a lane attribute. | Breaks FR-8's per-lane series; the `Gauge` extension is about three lines. | locked |
| R-4 | 1 | A third `maintenance` lane for the prune. | The spec defines two lanes and puts the prune in the lowest. | locked |
| R-5 | 1 | Releasing leases at shutdown. | Database I/O inside a cancellation handler is the fix-python-loop-supervision trap (`fails.md`). | locked |
| R-6 | 1 | Claim takes expired leases directly, with no separate reap. | Loses the clean count of expired attempts and complicates the claim index. | locked |
| R-7 | 1 | A `claim_seq BIGINT` fencing token as fallback for `gen_random_uuid()`. | Not needed: clusters are PG18 and CI is pg16. | locked |
| R-8 | 1 | Reusing `is_transient_db_error` as the failure classifier. | Transient is already the default; an allow-list of transients is the misuse recorded in `fails.md` (fix-python-loop-supervision). | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | The single `asyncio.Lock` gate has no wait bound. With handlers, poll statements and the heartbeat queued FIFO, a heartbeat can wait about N×10 s, above `lease_seconds`; the 45 s lease floor is unsound, and the park transaction is (2×children+2) statements long. FR-2, D-11 (program). | yes | open |
| O-2 | 1 | An instance can reap its own healthy job and re-claim it; `_inflight` keyed by `job_id` alone lets the first task's `finally` delete the new task's entry, orphaning the new lease. The reap's outer UPDATE also does not re-check `state='running' AND lease_expires_at < now()`. FR-2. | yes | open |
| O-3 | 1 | Under `run_supervised` any heartbeat error becomes a 30 s backoff (`app/supervision.py:59-68`), which loses every held lease at the 45 s floor; the self-fence check does not run during the backoff. FR-2. | yes | open |
| O-4 | 1 | The self-fence deadline is stamped when the heartbeat reply arrives, so it trails the database deadline; an instance can run side effects after a takeover. | yes | open |
| O-5 | 1 | "At most one connection" covers only job-graph SQL. Handlers of later features using other repositories can hold both client connections and starve heartbeats. The handler database contract and the trigger for revisiting `DB_POOL_MAX` are unstated. F-06 watch; `@AC-4 @feature-176`. | yes | open |
| O-6 | 1 | Reap, settle, ensure and claim run in one tick; one failing step backs the whole tick off 30 s, stopping claims, and the real takeover bound is `lease + poll (≤60 s) + 30 s`, not `lease_seconds`. | yes | open |
| O-7 | 1 | The prune guard protects only children of `waiting` parents. A woken parent in `ready`/`running`/backoff can lose its edge through `ON DELETE CASCADE` and then re-park as a first run. A concurrent park and prune can raise an FK violation that burns an attempt. FR-4. | yes | open |
| O-8 | 1 | "No new edge inserted → permanent failure" fails a woken parent that idempotently re-declares the same children; `has_deps` is one bit and cannot express stages; no repository read lets a parent see its children. FR-4. | yes | open |
| O-9 | 1 | A failed report drops the job from `_inflight`, so a transient pool timeout re-runs completed work after a full lease and burns an attempt. | yes | open |
| O-10 | 1 | `task.cancel()` on a lost lease and `asyncio.timeout(900)` can interrupt the park transaction or a fenced report, which is database I/O under cancellation (`insights.md:3997-4000`). | yes | open |
| O-11 | 1 | The poll tick returns delay 0 after waiting on a slot-freed event; if the event is not cleared it spins issuing claims. | yes | open |
| O-12 | 1 | The idempotency window ends when a succeeded key is pruned, and `failed`/`dead`/`blocked` keys are kept forever with no requeue path, so a dead job permanently blocks every later parent on that key and such rows grow without bound. Needs an operator decision. FR-1, FR-7. | no (prune only) | open |
| O-13 | 1 | Cross-key relations cannot be enforced by bounds or `CROSS_KEY_ORDERING`: lease versus concurrency and gate wait; takeover bound versus the poll ceiling; `max_attempts=1` making a deploy-time lease expiry fatal. Also the seed must land in the same commit as its reader (`fails.md:3772-3775`). | yes | open |
| O-14 | 1 | C-18: `result JSONB` has no reader; the outcome set mixes attempt and report outcomes and under-counts reaped attempts; idle cost is four statements per second per instance for a daily job; park enqueues children row by row; the fenced report methods take no `conn=`, which the program's outbox needs. | no | open |
| O-15 | 1 | The proposal dropped the program plan's advisory-lock note without saying it overturns the plan (P-03). Resolved in substance by R-1; the program plan must be corrected. | no | open |
| O-16 | 1 | `Gauge.register()` is never called in the design; without it FR-8 / `@AC-13` export nothing. Stale-snapshot gauges also go dark during an outage. | yes | open |
| O-17 | 1 | "Measure in feature 3's shadow run" names no metric: gate and statement waits are not instrumented (`fails.md:3803-3805`). | no | open |
| O-18 | 1 | Bloat: most transitions are non-HOT because `state`, `next_attempt_at` and `finished_at` are indexed; no `fillfactor` and no named trigger for an autovacuum review. | no | open |
| O-19 | 1 | asyncpg's client-side `timeout=` cancel through PgBouncer is unproven and CI has no pooler (`insights.md:3999`, `fails.md:3320-3323`). The design must choose `SET LOCAL statement_timeout` in an explicit transaction or name who runs a pooler test. | yes | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
