# Pipeline job graph (feature 367)

The durable job graph and worker runtime inside `xstockstrat-analysis`. Design and rationale:
`docs/roadmap/features/367-pipeline-job-graph/design.md`. Config keys: the `pipeline.*` rows of this
service's `CLAUDE.md` § Config Keys Consumed.

## States

| State | Meaning |
|---|---|
| `ready` | Waiting to be claimed once `next_attempt_at` has passed. |
| `running` | Claimed; holds a `lease_token` and `lease_expires_at`, renewed by the heartbeat. |
| `waiting` | Parked on child jobs; the attempt that parked it is refunded. |
| `succeeded` | Finished. Pruned after `retention_days`. |
| `failed` | Terminal: a permanent error (`PermanentJobError`) or a failed `WaitOn` / `Verdict` check. |
| `dead` | Terminal: `max_attempts` used up (transient errors, or `last_error = 'lease_expired'`). |
| `blocked` | Terminal: the handler returned a verdict, or a child ended `failed`, `dead` or `blocked`. |

`failed`, `dead` and `blocked` rows are kept `max(30, retention_days)` days. The daily
`pipeline.retention_prune` job deletes older finished rows, terminal states first, and keeps any row
an unfinished parent still depends on.

**Lanes.** Lane `20` (`held`) is claimed before lane `10` (`watchlist`), then by `next_attempt_at`.

**At least once.** A job can run more than once (a lost lease, a crash, a report whose
acknowledgement was lost). Only the fenced report is exactly once; every other effect a handler has
must be idempotent.

## Timing

Fixed, not config keys: heartbeat every 7.5 s; self-fence 3 s before the lease last renewed would
expire; tolerated event-loop lag 2 s; attempt deadline 900 s; stop grace 10 s; report give-up 300 s
after the handler ends; maintenance (reap, settle, daily ensure, stats every third tick) every 5 s;
idle claim delay at most 5 s; control operations 5 s, heartbeat 3 s, handler blocks at most 30 s.

A job whose worker stopped is claimable again within `lease_seconds` + 10 s, plus up to 4 s of
event-loop lag (70 s at the default lease, 74 s with lag), provided an instance is enabled, has that
job kind registered and has a free slot, and the database answers normally.

## Manual recovery

There is no requeue RPC until program feature 4. Every statement is guarded by the job id and the
expected state, so a repeated or concurrent run changes nothing once the row has moved.

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
recovery, so walk upward one level at a time, recovering each `blocked` parent with the
`blocked`-job SQL above. Start each walk at least 10 s after the recovery commits, so a settle that
read the job as `blocked` before the commit has finished. A recovered `failed` or `dead` job keeps
its `wait_round` and edges and re-runs its current stage, as a transient retry does; a recovered
`blocked` job restarts at round 0.

## What to watch

- `loop tick ok loop=pipeline_worker`: absent for over 60 s while enabled means every slot is held
  or the claim loop is dead.
- `analysis.pipeline.lease_events{outcome=handler_abandoned}`: a handler ignored its stop.
- `analysis.pipeline.attempts{outcome=dead}`: jobs out of attempts, the daily prune included.
- `analysis.pipeline.oldest_ready_age` and `analysis.pipeline.ready_depth`: absent means the worker
  is disabled or the stats step is failing, not an empty queue.
- `analysis.pipeline.db.duration{phase=wait}`: time spent waiting for a control or service
  connection (PgBouncer queueing shows here).

No alert ships with this feature.

## A job is not running

Check, in order:

1. Its row: `state`, `next_attempt_at`, `lease_expires_at`, `attempts`, `last_error`.
2. Its children, through `analysis.pipeline_job_deps` (`parent_id = <id>`), if it is `waiting`.
3. `analysis.pipeline.worker_enabled`.
4. Whether the running code registers its kind (`app/jobs/__init__.py:build_registry`). A job of a
   kind no instance registers stays `ready` and pins the ready gauges; retiring a kind means
   draining or deleting its rows.

`pipeline.worker_enabled = false` stops claims, the daily ensure and reaping, so `running` rows past
their expiry are expected until it is re-enabled; jobs already running finish (up to 900 s) and
write their result. An instance whose slots are all held by unresponsive handlers stops claiming
and needs a restart.

## Accepted risks

- No requeue until program feature 4: a `dead` or `failed` key blocks parents on the same key for
  that epoch until the manual recovery above.
- A job of a kind no running instance registers pins the ready gauges (see above).
- A prune that fails every day ends `dead` each day and nothing is pruned; it shows only as
  `attempts{outcome=dead}`.
- Under a report outage an instance stops claiming for up to 300 s (314 s when a try was already
  started) after its handlers end, because a slot is held until the report is written or abandoned.
- A heartbeat already in flight when a self-fence fires can extend that lease once, so such a job is
  claimable up to `lease_seconds` + 6 s after the self-fence.
