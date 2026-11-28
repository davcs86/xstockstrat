"""Pipeline job graph repository (feature 367): the control lane and every job-table statement."""

import asyncio
import time
from contextlib import asynccontextmanager

from app.repositories.read_budget import bounded_txn

# Recorded invariants (design.md § Build order), not config keys.
CONTROL_BUDGET_S = 5.0
HEARTBEAT_BUDGET_S = 3.0
BATCH_SIZE = 500

FINISHED_STATES = ("succeeded", "failed", "dead", "blocked")
_FINISHED_SQL = "('succeeded', 'failed', 'dead', 'blocked')"
_COLUMNS = "job_id, kind, subject, epoch, run_id, lane, attempts, wait_round, lease_token"


class ParkRace(Exception):
    """A child the park declared was deleted by a concurrent prune; re-run the park."""


CLAIM_SQL = f"""
WITH c AS (
    SELECT job_id FROM analysis.pipeline_jobs
     WHERE state = 'ready' AND next_attempt_at <= now() AND kind = ANY($1::text[])
     ORDER BY lane DESC, next_attempt_at, job_id
     LIMIT $2
       FOR NO KEY UPDATE SKIP LOCKED
)
UPDATE analysis.pipeline_jobs j
   SET state = 'running', attempts = j.attempts + 1, lease_token = gen_random_uuid(),
       lease_expires_at = now() + make_interval(secs => $3::float8)
  FROM c
 WHERE j.job_id = c.job_id
RETURNING {", ".join(f"j.{c}" for c in _COLUMNS.split(", "))}
"""

_REAP_SQL = """
WITH c AS (
    SELECT job_id FROM analysis.pipeline_jobs
     WHERE state = 'running' AND lease_expires_at < now()
     ORDER BY job_id
       FOR NO KEY UPDATE SKIP LOCKED
)
UPDATE analysis.pipeline_jobs j
   SET state = CASE WHEN j.attempts >= $1 THEN 'dead' ELSE 'ready' END,
       next_attempt_at = CASE WHEN j.attempts >= $1 THEN j.next_attempt_at ELSE now() END,
       error_class = CASE WHEN j.attempts >= $1 THEN 'transient' ELSE j.error_class END,
       last_error = CASE WHEN j.attempts >= $1 THEN 'lease_expired' ELSE j.last_error END,
       finished_at = CASE WHEN j.attempts >= $1 THEN now() END,
       lease_token = NULL, lease_expires_at = NULL
  FROM c
 WHERE j.job_id = c.job_id AND j.state = 'running' AND j.lease_expires_at < now()
RETURNING j.state
"""

_HEARTBEAT_SQL = """
UPDATE analysis.pipeline_jobs j
   SET lease_expires_at = now() + make_interval(secs => $3::float8)
  FROM unnest($1::bigint[], $2::uuid[]) AS p(job_id, lease_token)
 WHERE j.job_id = p.job_id AND j.lease_token = p.lease_token AND j.state = 'running'
RETURNING j.job_id, j.lease_token
"""

_REPORT_SQL = """
UPDATE analysis.pipeline_jobs
   SET state = CASE $3::text
                   WHEN 'succeeded' THEN 'succeeded'
                   WHEN 'permanent' THEN 'failed'
                   WHEN 'verdict' THEN 'blocked'
                   ELSE CASE WHEN attempts >= $4::int THEN 'dead' ELSE 'ready' END
               END,
       verdict = CASE WHEN $3::text = 'verdict' THEN $5::text ELSE verdict END,
       error_class = CASE $3::text
                         WHEN 'permanent' THEN 'permanent'
                         WHEN 'transient' THEN 'transient'
                         ELSE error_class
                     END,
       last_error = CASE WHEN $3::text IN ('permanent', 'transient') THEN $6::text
                         ELSE last_error END,
       next_attempt_at = CASE WHEN $3::text = 'transient' AND attempts < $4::int
                              THEN now() + make_interval(secs => $7::float8)
                              ELSE next_attempt_at END,
       finished_at = CASE WHEN $3::text = 'transient' AND attempts < $4::int THEN NULL
                          ELSE now() END,
       lease_token = NULL, lease_expires_at = NULL
 WHERE job_id = $1 AND lease_token = $2 AND state = 'running'
RETURNING state
"""

_PARK_FENCE_SQL = """
SELECT run_id, lane FROM analysis.pipeline_jobs
 WHERE job_id = $1 AND lease_token = $2 AND state = 'running'
   FOR NO KEY UPDATE
"""

_PARK_INSERT_SQL = """
INSERT INTO analysis.pipeline_jobs (kind, subject, epoch, run_id, lane, state, next_attempt_at)
SELECT c.k, c.s, c.e, $5, COALESCE(c.l, $6), 'ready', now()
  FROM unnest($1::text[], $2::text[], $3::text[], $4::smallint[])
       WITH ORDINALITY AS c(k, s, e, l, ord)
 ORDER BY c.ord
ON CONFLICT (kind, subject, epoch) DO NOTHING
"""

_PARK_LOCK_SQL = """
SELECT j.job_id
  FROM analysis.pipeline_jobs j
  JOIN unnest($1::text[], $2::text[], $3::text[]) WITH ORDINALITY AS c(k, s, e, ord)
    ON j.kind = c.k AND j.subject = c.s AND j.epoch = c.e
 ORDER BY c.ord
   FOR KEY SHARE OF j
"""

_PARK_EDGES_SQL = """
INSERT INTO analysis.pipeline_job_deps (parent_id, child_id)
SELECT $1, unnest($2::bigint[])
ON CONFLICT (parent_id, child_id) DO NOTHING
"""

_PARK_WAIT_SQL = """
UPDATE analysis.pipeline_jobs
   SET state = 'waiting', lease_token = NULL, lease_expires_at = NULL, attempts = attempts - 1
 WHERE job_id = $1
"""

# One statement: candidates, target state and verdict share a snapshot (design.md § Settle).
_SETTLE_SQL = f"""
UPDATE analysis.pipeline_jobs j
   SET state = CASE WHEN v.verdict IS NULL THEN 'ready' ELSE 'blocked' END,
       wait_round = CASE WHEN v.verdict IS NULL THEN j.wait_round + 1 ELSE j.wait_round END,
       next_attempt_at = CASE WHEN v.verdict IS NULL THEN now() ELSE j.next_attempt_at END,
       verdict = v.verdict,
       finished_at = CASE WHEN v.verdict IS NULL THEN NULL ELSE now() END
  FROM (
    SELECT p.job_id,
           (SELECT CASE c.state WHEN 'failed' THEN 'dependency_failed'
                                WHEN 'dead' THEN 'dependency_dead'
                                ELSE c.verdict END
              FROM analysis.pipeline_job_deps d
              JOIN analysis.pipeline_jobs c ON c.job_id = d.child_id
             WHERE d.parent_id = p.job_id AND c.state IN ('failed', 'dead', 'blocked')
             ORDER BY c.job_id
             LIMIT 1) AS verdict
      FROM analysis.pipeline_jobs p
     WHERE p.state = 'waiting'
       AND (EXISTS (SELECT 1 FROM analysis.pipeline_job_deps d
                      JOIN analysis.pipeline_jobs c ON c.job_id = d.child_id
                     WHERE d.parent_id = p.job_id AND c.state IN ('failed', 'dead', 'blocked'))
            OR NOT EXISTS (SELECT 1 FROM analysis.pipeline_job_deps d
                             JOIN analysis.pipeline_jobs c ON c.job_id = d.child_id
                            WHERE d.parent_id = p.job_id AND c.state <> 'succeeded'))
     ORDER BY p.job_id
     LIMIT {BATCH_SIZE}
       FOR NO KEY UPDATE OF p SKIP LOCKED
  ) v
 WHERE j.job_id = v.job_id
RETURNING j.state
"""

_LIST_BY_RUN_SQL = """
SELECT job_id, kind, subject, epoch, lane, state FROM analysis.pipeline_jobs
 WHERE run_id = $1 ORDER BY job_id
"""

_READY_STATS_SQL = """
SELECT lane, count(*)::int AS depth,
       EXTRACT(EPOCH FROM now() - min(next_attempt_at))::float8 AS age
  FROM analysis.pipeline_jobs
 WHERE state = 'ready' AND next_attempt_at <= now()
 GROUP BY lane
"""

_UNFINISHED_PARENT_GUARD = f"""NOT EXISTS (
    SELECT 1 FROM analysis.pipeline_job_deps d
      JOIN analysis.pipeline_jobs p ON p.job_id = d.parent_id
     WHERE d.child_id = j.job_id AND p.state NOT IN {_FINISHED_SQL})"""


def prune_candidates_sql(state: str) -> str:
    # The state is a literal so the planner can prove the finished-rows partial index.
    if state not in FINISHED_STATES:
        raise ValueError(f"not a finished state: {state!r}")
    return f"""
SELECT j.job_id FROM analysis.pipeline_jobs j
 WHERE j.state = '{state}' AND j.finished_at < $1 AND {_UNFINISHED_PARENT_GUARD}
 LIMIT {BATCH_SIZE}
   FOR UPDATE OF j SKIP LOCKED
"""


_PRUNE_DELETE_SQL = f"""
DELETE FROM analysis.pipeline_jobs j
 WHERE j.job_id = ANY($1::bigint[]) AND {_UNFINISHED_PARENT_GUARD}
"""


def _count(tag: str) -> int:
    return int(tag.rsplit(" ", 1)[-1])


async def prune_batch(*, conn, state, older_than_days, cutoff=None):
    """One prune batch on the caller's transaction → (candidates, deleted, cutoff, full)."""
    if cutoff is None:
        cutoff = await conn.fetchval(
            "SELECT now() - make_interval(days => $1::int)", older_than_days
        )
    rows = await conn.fetch(prune_candidates_sql(state), cutoff)
    ids = [r["job_id"] for r in rows]
    deleted = _count(await conn.execute(_PRUNE_DELETE_SQL, ids)) if ids else 0
    return len(ids), deleted, cutoff, len(ids) == BATCH_SIZE


class PipelineJobsRepository:
    def __init__(self, control_pool, *, monotonic=time.monotonic):
        self._pool = control_pool
        self._monotonic = monotonic
        # FIFO; taken before the control-pool acquire, released after the connection is returned.
        self._lane = asyncio.Lock()

    @asynccontextmanager
    async def lane(self):
        async with self._lane:
            yield

    @asynccontextmanager
    async def _txn(self, conn=None, *, lane_held=False):
        if conn is not None:
            yield conn
        elif lane_held:
            async with bounded_txn(self._pool, CONTROL_BUDGET_S, monotonic=self._monotonic) as tx:
                yield tx
        else:
            async with self._lane:
                async with bounded_txn(
                    self._pool, CONTROL_BUDGET_S, monotonic=self._monotonic
                ) as tx:
                    yield tx

    async def enqueue(self, kind, subject, epoch, *, run_id, lane, conn=None):
        """Insert if absent → (job_id, created); an existing row keeps its run_id and lane."""
        insert = """
INSERT INTO analysis.pipeline_jobs (kind, subject, epoch, run_id, lane, state, next_attempt_at)
VALUES ($1, $2, $3, $4, $5, 'ready', now())
ON CONFLICT (kind, subject, epoch) DO NOTHING
RETURNING job_id
"""
        select = """
SELECT job_id FROM analysis.pipeline_jobs WHERE kind = $1 AND subject = $2 AND epoch = $3
"""
        args = (kind, subject, epoch)
        async with self._txn(conn) as tx:
            for _ in range(2):
                job_id = await tx.fetchval(insert, *args, run_id, int(lane))
                if job_id is not None:
                    return job_id, True
                job_id = await tx.fetchval(select, *args)
                if job_id is not None:
                    return job_id, False
        raise RuntimeError(f"enqueue of {kind}/{subject}/{epoch} found no row twice")

    async def claim(self, kinds, limit, lease_seconds, *, conn=None, lane_held=False):
        """Claim up to `limit` ready jobs → (rows, send time of the claim transaction)."""
        if not kinds or limit <= 0:
            return [], None
        async with self._txn(conn, lane_held=lane_held) as tx:
            rows = await tx.fetch(CLAIM_SQL, list(kinds), int(limit), float(lease_seconds))
            sent = getattr(tx, "begin_sent_at", None)
        return [dict(r) for r in rows], sent

    async def reap(self, max_attempts, *, conn=None):
        """Requeue or kill expired leases → (requeued, dead); attempts are not incremented."""
        async with self._txn(conn) as tx:
            rows = await tx.fetch(_REAP_SQL, int(max_attempts))
        dead = sum(1 for r in rows if r["state"] == "dead")
        return len(rows) - dead, dead

    async def heartbeat(self, pairs, lease_seconds):
        """Renew held leases → (renewed pairs, send time); raises unless COMMIT returned COMMIT."""
        if not pairs:
            return set(), None
        ids = [job_id for job_id, _ in pairs]
        tokens = [token for _, token in pairs]
        async with bounded_txn(self._pool, HEARTBEAT_BUDGET_S, monotonic=self._monotonic) as tx:
            rows = await tx.fetch(_HEARTBEAT_SQL, ids, tokens, float(lease_seconds))
            sent = tx.begin_sent_at
        return {(r["job_id"], r["lease_token"]) for r in rows}, sent

    async def report(
        self,
        job_id,
        lease_token,
        outcome,
        *,
        max_attempts,
        retry_delay_s=0,
        verdict=None,
        error=None,
        lane_held=False,
    ):
        """Fenced report → the state written, or None when the fence matched nothing.

        `outcome` is one of `succeeded`, `permanent`, `verdict`, `transient`.
        """
        async with self._txn(lane_held=lane_held) as tx:
            return await tx.fetchval(
                _REPORT_SQL,
                job_id,
                lease_token,
                outcome,
                int(max_attempts),
                verdict,
                error,
                float(retry_delay_s),
            )

    async def park(self, job_id, lease_token, children, *, lane_held=False):
        """Park on `children` (deduplicated, sorted `(kind, subject, epoch, lane | None)`).

        → True, False when fenced out; raises ParkRace when a child was pruned meanwhile.
        """
        # Key order is the lock order, so overlapping parks never deadlock on the unique index.
        children = sorted(children, key=lambda c: (c[0], c[1], c[2]))
        kinds = [c[0] for c in children]
        subjects = [c[1] for c in children]
        epochs = [c[2] for c in children]
        lanes = [None if c[3] is None else int(c[3]) for c in children]
        async with self._txn(lane_held=lane_held) as tx:
            parent = await tx.fetchrow(_PARK_FENCE_SQL, job_id, lease_token)
            if parent is None:
                return False
            await tx.execute(
                _PARK_INSERT_SQL, kinds, subjects, epochs, lanes, parent["run_id"], parent["lane"]
            )
            locked = await tx.fetch(_PARK_LOCK_SQL, kinds, subjects, epochs)
            if len(locked) < len(children):
                raise ParkRace(f"job {job_id}: {len(children) - len(locked)} child(ren) vanished")
            await tx.execute(_PARK_EDGES_SQL, job_id, [r["job_id"] for r in locked])
            await tx.execute(_PARK_WAIT_SQL, job_id)
        return True

    async def settle_batch(self, *, conn=None):
        """Wake or block settleable waiting parents → (woken, blocked, full)."""
        async with self._txn(conn) as tx:
            rows = await tx.fetch(_SETTLE_SQL)
        blocked = sum(1 for r in rows if r["state"] == "blocked")
        return len(rows) - blocked, blocked, len(rows) == BATCH_SIZE

    async def list_by_run(self, run_id, *, conn=None):
        async with self._txn(conn) as tx:
            return [dict(r) for r in await tx.fetch(_LIST_BY_RUN_SQL, run_id)]

    async def ready_stats(self, *, conn=None):
        """Per lane value → (depth, age in seconds) of claimable ready rows; absent lanes read 0."""
        async with self._txn(conn) as tx:
            rows = await tx.fetch(_READY_STATS_SQL)
        stats = {10: (0, 0.0), 20: (0, 0.0)}
        for r in rows:
            stats[r["lane"]] = (r["depth"], r["age"])
        return stats
