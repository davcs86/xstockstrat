"""PipelineJobsRepository on a real PostgreSQL (feature 367): scenario and design gate tests."""

import asyncio
import time

import asyncpg.exceptions as apg
import pytest

from app.repositories import pipeline_jobs
from app.repositories.pipeline_jobs import (
    BATCH_SIZE,
    CLAIM_SQL,
    FINISHED_STATES,
    ParkRace,
    PipelineJobsRepository,
    prune_batch,
    prune_candidates_sql,
)
from tests.conftest import insert_pipeline_job, pipeline_pool, shift_pipeline_job

pytestmark = pytest.mark.real_pg

_GUARD_S = 15
_DAY = 86400
_KIND = ["probe"]

# Copied from design.md § Retention prune (manual recovery); Step 19's page prints the same SQL.
_RECOVER_FAILED_OR_DEAD = """
UPDATE analysis.pipeline_jobs
   SET state = 'ready', attempts = 0, next_attempt_at = now(), finished_at = NULL,
       verdict = NULL, error_class = NULL, last_error = NULL
 WHERE job_id = $1 AND state = $2
"""
_RECOVER_BLOCKED = (
    """
SELECT job_id FROM analysis.pipeline_jobs
 WHERE job_id = $1 AND state = 'blocked' FOR NO KEY UPDATE
""",
    """
DELETE FROM analysis.pipeline_job_deps
 WHERE parent_id = $1
   AND EXISTS (SELECT 1 FROM analysis.pipeline_jobs WHERE job_id = $1 AND state = 'blocked')
""",
    """
UPDATE analysis.pipeline_jobs
   SET state = 'ready', attempts = 0, wait_round = 0, next_attempt_at = now(), finished_at = NULL,
       verdict = NULL, error_class = NULL, last_error = NULL
 WHERE job_id = $1 AND state = 'blocked'
""",
)


async def _row(pool, job_id):
    return await pool.fetchrow("SELECT * FROM analysis.pipeline_jobs WHERE job_id = $1", job_id)


async def _edges(pool, parent_id):
    return [
        r["child_id"]
        for r in await pool.fetch(
            "SELECT child_id FROM analysis.pipeline_job_deps WHERE parent_id = $1 ORDER BY 1",
            parent_id,
        )
    ]


async def _edge(pool, parent_id, child_id):
    await pool.execute(
        "INSERT INTO analysis.pipeline_job_deps (parent_id, child_id) VALUES ($1, $2)",
        parent_id,
        child_id,
    )


async def _claim_one(repo, job_id, lease_seconds=60):
    rows, _ = await repo.claim(_KIND, 100, lease_seconds)
    (row,) = [r for r in rows if r["job_id"] == job_id]
    return row


async def _claim_all(repo, *job_ids):
    rows, _ = await repo.claim(_KIND, 1000, 60)
    by_id = {r["job_id"]: r for r in rows}
    return [by_id[j] for j in job_ids]


def _key(subject, lane=None):
    return ("probe", subject, "2026-11-27", lane)


def _count(tag):
    return int(tag.rsplit(" ", 1)[-1])


# ---------------------------------------------------------------- scenarios


async def test_ac1_enqueue_is_idempotent_by_key(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    job_id, created = await repo.enqueue("probe", "AAPL", "2026-11-27", run_id="run-a", lane=10)
    again = await repo.enqueue("probe", "AAPL", "2026-11-27", run_id="run-b", lane=20)
    assert created is True and again == (job_id, False)
    assert await pipeline_pg.fetchval("SELECT count(*) FROM analysis.pipeline_jobs") == 1
    row = await _row(pipeline_pg, job_id)
    assert (row["run_id"], row["lane"], row["state"]) == ("run-a", 10, "ready")


async def test_ac2_two_claimers_never_take_the_same_job(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        a, b = PipelineJobsRepository(pipeline_pg), PipelineJobsRepository(other)
        for i in range(10):
            await insert_pipeline_job(pipeline_pg, subject=f"S{i}")
            (ra, _), (rb, _) = await asyncio.wait_for(
                asyncio.gather(a.claim(_KIND, 1, 60), b.claim(_KIND, 1, 60)), _GUARD_S
            )
            assert len(ra) + len(rb) == 1
    finally:
        await other.close()


async def test_ac3_expired_lease_is_reaped_and_reclaimed_with_attempt_two(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        first, second = PipelineJobsRepository(pipeline_pg), PipelineJobsRepository(other)
        job_id = await insert_pipeline_job(pipeline_pg)
        held = await _claim_one(first, job_id)
        await shift_pipeline_job(pipeline_pg, job_id, lease_expires_at=-61)
        assert await second.reap(5) == (1, 0)
        taken = await _claim_one(second, job_id)
        assert taken["lease_token"] != held["lease_token"] and taken["attempts"] == 2
    finally:
        await other.close()


async def test_ac4_fenced_report_is_rejected_and_the_finish_time_kept(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        first, second = PipelineJobsRepository(pipeline_pg), PipelineJobsRepository(other)
        job_id = await insert_pipeline_job(pipeline_pg)
        stale = await _claim_one(first, job_id)
        await shift_pipeline_job(pipeline_pg, job_id, lease_expires_at=-61)
        await second.reap(5)
        live = await _claim_one(second, job_id)
        written = await second.report(job_id, live["lease_token"], "succeeded", max_attempts=5)
        assert written == "succeeded"
        finished_at = (await _row(pipeline_pg, job_id))["finished_at"]
        assert await first.report(job_id, stale["lease_token"], "succeeded", max_attempts=5) is None
        row = await _row(pipeline_pg, job_id)
        assert row["state"] == "succeeded" and row["finished_at"] == finished_at
    finally:
        await other.close()


async def test_ac5_transient_failure_is_ready_again_only_after_its_delay(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    job_id = await insert_pipeline_job(pipeline_pg)
    held = await _claim_one(repo, job_id)
    state = await repo.report(
        job_id, held["lease_token"], "transient", max_attempts=5, retry_delay_s=5, error="boom"
    )
    row = await _row(pipeline_pg, job_id)
    assert state == "ready" and row["attempts"] == 1 and row["error_class"] == "transient"
    assert (await repo.claim(_KIND, 10, 60))[0] == []
    await shift_pipeline_job(pipeline_pg, job_id, next_attempt_at=-1)
    assert [r["job_id"] for r in (await repo.claim(_KIND, 10, 60))[0]] == [job_id]


async def test_ac6_permanent_failure_ends_failed_and_is_never_claimed(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    job_id = await insert_pipeline_job(pipeline_pg)
    held = await _claim_one(repo, job_id)
    assert (
        await repo.report(job_id, held["lease_token"], "permanent", max_attempts=5, error="bad")
        == "failed"
    )
    row = await _row(pipeline_pg, job_id)
    assert row["error_class"] == "permanent" and row["finished_at"] is not None
    await shift_pipeline_job(pipeline_pg, job_id, next_attempt_at=-60)
    assert (await repo.claim(_KIND, 10, 60))[0] == []


async def test_ac7_fifth_attempt_ends_dead_by_report_and_by_reap(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    job_id = await insert_pipeline_job(pipeline_pg, attempts=4)
    held = await _claim_one(repo, job_id)
    assert held["attempts"] == 5
    state = await repo.report(job_id, held["lease_token"], "transient", max_attempts=5)
    assert state == "dead"
    reaped = await insert_pipeline_job(pipeline_pg, subject="MSFT", state="running", attempts=5)
    await shift_pipeline_job(pipeline_pg, reaped, lease_expires_at=-1)
    assert await repo.reap(5) == (0, 1)
    row = await _row(pipeline_pg, reaped)
    assert (row["state"], row["error_class"], row["last_error"]) == (
        "dead",
        "transient",
        "lease_expired",
    )
    assert (await repo.claim(_KIND, 10, 60))[0] == []


async def test_ac8_parked_parent_is_woken_when_its_child_succeeds(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    parent = await insert_pipeline_job(pipeline_pg, subject="PARENT")
    held = await _claim_one(repo, parent)
    assert await repo.park(parent, held["lease_token"], [_key("CHILD")]) is True
    row = await _row(pipeline_pg, parent)
    assert (row["state"], row["attempts"], row["lease_token"]) == ("waiting", 0, None)
    rows, _ = await repo.claim(_KIND, 10, 60)
    (child,) = rows
    assert child["subject"] == "CHILD" and child["run_id"] == "run-2026-11-27"
    assert await repo.settle_batch() == (0, 0, False)
    await repo.report(child["job_id"], child["lease_token"], "succeeded", max_attempts=5)
    assert await repo.settle_batch() == (1, 0, False)
    row = await _row(pipeline_pg, parent)
    assert (row["state"], row["wait_round"]) == ("ready", 1)
    assert [r["job_id"] for r in (await repo.claim(_KIND, 10, 60))[0]] == [parent]


async def test_ac9_child_verdict_blocks_the_parent(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    parent = await insert_pipeline_job(pipeline_pg, subject="PARENT")
    held = await _claim_one(repo, parent)
    await repo.park(parent, held["lease_token"], [_key("CHILD")])
    (child,), _ = await repo.claim(_KIND, 10, 60)
    await repo.report(
        child["job_id"], child["lease_token"], "verdict", max_attempts=5, verdict="no_vendor_data"
    )
    assert await repo.settle_batch() == (0, 1, False)
    row = await _row(pipeline_pg, parent)
    assert (row["state"], row["verdict"]) == ("blocked", "no_vendor_data")
    assert row["finished_at"] is not None


@pytest.mark.parametrize(
    ("child_states", "verdict"),
    [
        (["failed"], "dependency_failed"),
        (["dead"], "dependency_dead"),
        (["dead", "failed", "blocked"], "dependency_dead"),
        (["blocked", "dead"], "no_vendor_data"),
        (["succeeded", "failed"], "dependency_failed"),
    ],
)
async def test_ac9_lowest_failed_child_decides_the_verdict(pipeline_pg, child_states, verdict):
    repo = PipelineJobsRepository(pipeline_pg)
    parent = await insert_pipeline_job(pipeline_pg, subject="PARENT", state="waiting")
    for i, state in enumerate(child_states):
        child = await insert_pipeline_job(pipeline_pg, subject=f"C{i}", state=state)
        await _edge(pipeline_pg, parent, child)
    await repo.settle_batch()
    assert (await _row(pipeline_pg, parent))["verdict"] == verdict


async def test_ac10_held_lane_is_claimed_before_an_older_watchlist_job(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    watch = await insert_pipeline_job(pipeline_pg, subject="WATCH", lane=10)
    held = await insert_pipeline_job(pipeline_pg, subject="HELD", lane=20)
    await shift_pipeline_job(pipeline_pg, watch, next_attempt_at=-100)
    await shift_pipeline_job(pipeline_pg, held, next_attempt_at=-10)
    rows, _ = await repo.claim(_KIND, 1, 60)
    assert [r["job_id"] for r in rows] == [held]


async def test_ac11_jobs_are_listed_by_run(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    ids = [
        await insert_pipeline_job(pipeline_pg, subject=s, state=st)
        for s, st in (("A", "ready"), ("B", "running"), ("C", "succeeded"))
    ]
    await insert_pipeline_job(pipeline_pg, subject="D", run_id="run-2026-11-26")
    listed = await repo.list_by_run("run-2026-11-27")
    assert [(r["job_id"], r["state"]) for r in listed] == list(
        zip(ids, ["ready", "running", "succeeded"], strict=True)
    )


async def test_ac12_succeeded_rows_go_after_retention_days_and_terminal_rows_stay(pipeline_pg):
    ids = {}
    for state in FINISHED_STATES:
        ids[state] = await insert_pipeline_job(pipeline_pg, subject=state, state=state)
        await shift_pipeline_job(pipeline_pg, ids[state], finished_at=-8 * _DAY)
    async with pipeline_pg.acquire() as c, c.transaction():
        result = await prune_batch(conn=c, state="succeeded", older_than_days=7)
        assert result[:2] == (1, 1) and result[3] is False
        for state in ("failed", "dead", "blocked"):
            assert (await prune_batch(conn=c, state=state, older_than_days=30))[:2] == (0, 0)
    left = {r["state"] for r in await pipeline_pg.fetch("SELECT state FROM analysis.pipeline_jobs")}
    assert left == {"failed", "dead", "blocked"}


async def test_ac18_dead_rows_go_after_thirty_days(pipeline_pg):
    old = await insert_pipeline_job(pipeline_pg, subject="OLD", state="dead")
    young = await insert_pipeline_job(pipeline_pg, subject="YOUNG", state="dead")
    await shift_pipeline_job(pipeline_pg, old, finished_at=-31 * _DAY)
    await shift_pipeline_job(pipeline_pg, young, finished_at=-29 * _DAY)
    async with pipeline_pg.acquire() as c, c.transaction():
        assert (await prune_batch(conn=c, state="dead", older_than_days=30))[:2] == (1, 1)
    assert await _row(pipeline_pg, old) is None and await _row(pipeline_pg, young) is not None


async def test_ac13_ready_stats_count_only_claimable_rows(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    for i, age in enumerate((120, 60, 30, 1)):
        job_id = await insert_pipeline_job(pipeline_pg, subject=f"R{i}")
        await shift_pipeline_job(pipeline_pg, job_id, next_attempt_at=-age)
    future = await insert_pipeline_job(pipeline_pg, subject="LATER")
    await shift_pipeline_job(pipeline_pg, future, next_attempt_at=300)
    stats = await repo.ready_stats()
    depth, age = stats[10]
    assert depth == 4 and age >= 120 and stats[20] == (0, 0.0)


# ---------------------------------------------------------------- design gate tests


async def test_park_re_declaring_an_existing_child_succeeds(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    parent = await insert_pipeline_job(pipeline_pg, subject="PARENT")
    held = await _claim_one(repo, parent)
    await repo.park(parent, held["lease_token"], [_key("CHILD")])
    (child,), _ = await repo.claim(_KIND, 10, 60)
    await repo.report(child["job_id"], child["lease_token"], "succeeded", max_attempts=5)
    await repo.settle_batch()
    again = await _claim_one(repo, parent)
    assert await repo.park(parent, again["lease_token"], [_key("CHILD"), _key("OTHER")]) is True
    assert len(await _edges(pipeline_pg, parent)) == 2


async def test_overlapping_parks_in_opposite_order_do_not_deadlock(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        a, b = PipelineJobsRepository(pipeline_pg), PipelineJobsRepository(other)
        for i in range(5):
            p1 = await insert_pipeline_job(pipeline_pg, subject=f"P1-{i}")
            p2 = await insert_pipeline_job(pipeline_pg, subject=f"P2-{i}")
            h1, h2 = await _claim_all(a, p1, p2)
            keys = [_key(f"X{i}-{n}") for n in range(20)]
            done = await asyncio.wait_for(
                asyncio.gather(
                    a.park(p1, h1["lease_token"], keys),
                    b.park(p2, h2["lease_token"], list(reversed(keys))),
                ),
                _GUARD_S,
            )
            assert done == [True, True]
            assert len(await _edges(pipeline_pg, p1)) == len(await _edges(pipeline_pg, p2)) == 20
    finally:
        await other.close()


async def test_park_naming_a_concurrently_parking_job_as_child_neither_waits_nor_deadlocks(
    pipeline_pg, local_pg
):
    other = await pipeline_pool(local_pg)
    try:
        a, b = PipelineJobsRepository(pipeline_pg), PipelineJobsRepository(other)
        top = await insert_pipeline_job(pipeline_pg, subject="TOP")
        mid = await insert_pipeline_job(pipeline_pg, subject="MID")
        ht, hm = await _claim_all(a, top, mid)
        done = await asyncio.wait_for(
            asyncio.gather(
                a.park(top, ht["lease_token"], [_key("MID"), _key("NEW")]),
                b.park(mid, hm["lease_token"], [_key("NEW"), _key("LEAF")]),
            ),
            5,
        )
        assert done == [True, True]
        assert (await _row(pipeline_pg, mid))["state"] == "waiting"
    finally:
        await other.close()


async def test_prune_delete_keeps_a_row_that_gained_an_unfinished_parent(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        repo = PipelineJobsRepository(other)
        child = await insert_pipeline_job(pipeline_pg, subject="CHILD", state="succeeded")
        await shift_pipeline_job(pipeline_pg, child, finished_at=-8 * _DAY)
        parent = await insert_pipeline_job(pipeline_pg, subject="PARENT")
        held = await _claim_one(repo, parent)
        async with pipeline_pg.acquire() as c, c.transaction():
            cutoff = await c.fetchval("SELECT now() - interval '7 days'")
            unlocked = prune_candidates_sql("succeeded").replace("FOR UPDATE OF j SKIP LOCKED", "")
            ids = [r["job_id"] for r in await c.fetch(unlocked, cutoff)]
            assert ids == [child]
            assert await repo.park(parent, held["lease_token"], [_key("CHILD")]) is True
            await c.execute(
                "SELECT 1 FROM analysis.pipeline_jobs WHERE job_id = ANY($1) FOR UPDATE", ids
            )
            assert _count(await c.execute(pipeline_jobs._PRUNE_DELETE_SQL, ids)) == 0
        assert await _row(pipeline_pg, child) is not None
        assert await _edges(pipeline_pg, parent) == [child]
    finally:
        await other.close()


async def test_park_racing_an_open_prune_batch_raises_park_race_then_reruns(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        repo = PipelineJobsRepository(other)
        child = await insert_pipeline_job(pipeline_pg, subject="CHILD", state="succeeded")
        await shift_pipeline_job(pipeline_pg, child, finished_at=-8 * _DAY)
        parent = await insert_pipeline_job(pipeline_pg, subject="PARENT")
        held = await _claim_one(repo, parent)
        async with pipeline_pg.acquire() as c:
            tr = c.transaction()
            await tr.start()
            cutoff = await c.fetchval("SELECT now() - interval '7 days'")
            ids = [r["job_id"] for r in await c.fetch(prune_candidates_sql("succeeded"), cutoff)]
            park = asyncio.create_task(repo.park(parent, held["lease_token"], [_key("CHILD")]))
            await asyncio.sleep(0.5)
            assert not park.done()
            assert _count(await c.execute(pipeline_jobs._PRUNE_DELETE_SQL, ids)) == 1
            await tr.commit()
        with pytest.raises(ParkRace):
            await asyncio.wait_for(park, _GUARD_S)
        assert (await _row(pipeline_pg, parent))["state"] == "running"
        assert await repo.park(parent, held["lease_token"], [_key("CHILD")]) is True
        (edge,) = await _edges(pipeline_pg, parent)
        assert edge != child and (await _row(pipeline_pg, edge))["state"] == "ready"
        assert (await _row(pipeline_pg, parent))["state"] == "waiting"
    finally:
        await other.close()


async def test_park_after_an_uncommitted_prune_delete_inserts_the_child_afresh(
    pipeline_pg, local_pg
):
    other = await pipeline_pool(local_pg)
    try:
        repo = PipelineJobsRepository(other)
        child = await insert_pipeline_job(pipeline_pg, subject="CHILD", state="succeeded")
        await shift_pipeline_job(pipeline_pg, child, finished_at=-8 * _DAY)
        parent = await insert_pipeline_job(pipeline_pg, subject="PARENT")
        held = await _claim_one(repo, parent)
        async with pipeline_pg.acquire() as c:
            tr = c.transaction()
            await tr.start()
            assert (await prune_batch(conn=c, state="succeeded", older_than_days=7))[1] == 1
            park = asyncio.create_task(repo.park(parent, held["lease_token"], [_key("CHILD")]))
            await asyncio.sleep(0.5)
            await tr.commit()
        assert await asyncio.wait_for(park, _GUARD_S) is True
        (edge,) = await _edges(pipeline_pg, parent)
        assert edge != child
    finally:
        await other.close()


async def _blocked_parent(pipeline_pg, repo, subject="PARENT"):
    parent = await insert_pipeline_job(pipeline_pg, subject=subject, state="waiting")
    failed = await insert_pipeline_job(pipeline_pg, subject=f"{subject}-F", state="failed")
    await _edge(pipeline_pg, parent, failed)
    await repo.settle_batch()
    assert (await _row(pipeline_pg, parent))["state"] == "blocked"
    return parent


async def _recover_blocked(pool, job_id):
    async with pool.acquire() as c, c.transaction():
        found = await c.fetchval(_RECOVER_BLOCKED[0], job_id)
        deleted = _count(await c.execute(_RECOVER_BLOCKED[1], job_id))
        updated = _count(await c.execute(_RECOVER_BLOCKED[2], job_id))
    return found, deleted, updated


async def test_blocked_recovery_run_twice_changes_nothing_the_second_time(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    parent = await _blocked_parent(pipeline_pg, repo)
    assert await _recover_blocked(pipeline_pg, parent) == (parent, 1, 1)
    held = await _claim_one(repo, parent)
    await repo.park(parent, held["lease_token"], [_key("NEXT")])
    assert await _recover_blocked(pipeline_pg, parent) == (None, 0, 0)
    assert len(await _edges(pipeline_pg, parent)) == 1
    assert (await _row(pipeline_pg, parent))["state"] == "waiting"


async def test_open_recovery_does_not_block_a_park_naming_the_blocked_row(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        repo = PipelineJobsRepository(other)
        blocked = await _blocked_parent(pipeline_pg, repo, subject="BLOCKED")
        parent = await insert_pipeline_job(pipeline_pg, subject="PARENT")
        held = await _claim_one(repo, parent)
        async with pipeline_pg.acquire() as c, c.transaction():
            assert await c.fetchval(_RECOVER_BLOCKED[0], blocked) == blocked
            parked = repo.park(parent, held["lease_token"], [_key("BLOCKED")])
            assert await asyncio.wait_for(parked, 3) is True
        assert await _edges(pipeline_pg, parent) == [blocked]
    finally:
        await other.close()


@pytest.mark.parametrize("state", ["failed", "dead"])
async def test_failed_or_dead_recovery_run_twice_changes_the_row_once(pipeline_pg, state):
    job_id = await insert_pipeline_job(pipeline_pg, state=state, attempts=5)
    first = await pipeline_pg.execute(_RECOVER_FAILED_OR_DEAD, job_id, state)
    second = await pipeline_pg.execute(_RECOVER_FAILED_OR_DEAD, job_id, state)
    assert (_count(first), _count(second)) == (1, 0)
    row = await _row(pipeline_pg, job_id)
    assert (row["state"], row["attempts"]) == ("ready", 0)


async def test_ten_thousand_child_park_and_settle_finish_within_five_seconds(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    parent = await insert_pipeline_job(pipeline_pg, subject="PARENT")
    held = await _claim_one(repo, parent)
    children = [_key(f"C{n:05d}") for n in range(10_000)]
    t0 = time.monotonic()
    assert await repo.park(parent, held["lease_token"], children) is True
    parked = time.monotonic() - t0
    await pipeline_pg.execute(
        "UPDATE analysis.pipeline_jobs SET state = 'succeeded', finished_at = now() "
        "WHERE job_id <> $1",
        parent,
    )
    t1 = time.monotonic()
    assert await repo.settle_batch() == (1, 0, False)
    assert parked + (time.monotonic() - t1) < 5.0


async def test_twelve_hundred_settleable_parents_take_three_full_or_partial_batches(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    await pipeline_pg.execute(
        """
INSERT INTO analysis.pipeline_jobs
       (kind, subject, epoch, run_id, lane, state, next_attempt_at, finished_at, error_class)
SELECT 'probe', 'dead-' || g, 'e', 'r', 10, 'dead', now(), now(), 'transient'
  FROM generate_series(1, 1200) g;
INSERT INTO analysis.pipeline_jobs
       (kind, subject, epoch, run_id, lane, state, next_attempt_at, finished_at, error_class)
SELECT 'probe', 'failed-' || g, 'e', 'r', 10, 'failed', now(), now(), 'permanent'
  FROM generate_series(1, 1200) g;
INSERT INTO analysis.pipeline_jobs (kind, subject, epoch, run_id, lane, state, next_attempt_at)
SELECT 'probe', 'parent-' || g, 'e', 'r', 10, 'waiting', now() FROM generate_series(1, 1200) g;
INSERT INTO analysis.pipeline_job_deps (parent_id, child_id)
SELECT p.job_id, c.job_id
  FROM analysis.pipeline_jobs p
  JOIN analysis.pipeline_jobs c
    ON c.subject IN ('dead-' || substr(p.subject, 8), 'failed-' || substr(p.subject, 8))
 WHERE p.subject LIKE 'parent-%';
"""
    )
    assert BATCH_SIZE == 500
    batches = [await repo.settle_batch() for _ in range(3)]
    assert batches == [(0, 500, True), (0, 500, True), (0, 200, False)]
    verdicts = await pipeline_pg.fetch(
        "SELECT DISTINCT state, verdict FROM analysis.pipeline_jobs WHERE subject LIKE 'parent-%'"
    )
    assert [tuple(r) for r in verdicts] == [("blocked", "dependency_dead")]


async def test_plans_use_the_partial_indexes_and_a_young_dead_row_survives(pipeline_pg):
    await pipeline_pg.execute(
        """
INSERT INTO analysis.pipeline_jobs (kind, subject, epoch, run_id, lane, state, next_attempt_at,
                                    finished_at, verdict)
SELECT 'probe', s || g, 'e', 'r', 10, s, now(), now(), CASE WHEN s = 'blocked' THEN 'v' END
  FROM generate_series(1, 5000) g,
       unnest(ARRAY['succeeded', 'failed', 'dead', 'blocked']) s;
INSERT INTO analysis.pipeline_jobs (kind, subject, epoch, run_id, lane, state, next_attempt_at)
SELECT 'probe', 'ready' || g, 'e', 'r', 10, 'ready', now() FROM generate_series(1, 50) g;
ANALYZE analysis.pipeline_jobs;
ANALYZE analysis.pipeline_job_deps;
"""
    )
    async with pipeline_pg.acquire() as c:
        cutoff = await c.fetchval("SELECT now() - interval '7 days'")
        for state in FINISHED_STATES:
            plan = "\n".join(
                r[0] for r in await c.fetch("EXPLAIN " + prune_candidates_sql(state), cutoff)
            )
            assert "idx_pipeline_jobs_state_finished_at" in plan, plan
        plan = "\n".join(r[0] for r in await c.fetch("EXPLAIN " + CLAIM_SQL, _KIND, 4, 60.0))
        assert "idx_pipeline_jobs_state_lane_next_attempt_at" in plan, plan
    young = await insert_pipeline_job(pipeline_pg, subject="YOUNG-DEAD", state="dead")
    await shift_pipeline_job(pipeline_pg, young, finished_at=-8 * _DAY)
    async with pipeline_pg.acquire() as c, c.transaction():
        await prune_batch(conn=c, state="dead", older_than_days=max(30, 7))
    assert await _row(pipeline_pg, young) is not None


async def test_key_share_holders_do_not_stop_settle_or_claim(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        repo = PipelineJobsRepository(other)
        waiting = await insert_pipeline_job(pipeline_pg, subject="WAITING", state="waiting")
        done = await insert_pipeline_job(pipeline_pg, subject="DONE", state="succeeded")
        await _edge(pipeline_pg, waiting, done)
        ready = await insert_pipeline_job(pipeline_pg, subject="READY")
        async with pipeline_pg.acquire() as c, c.transaction():
            await c.execute(
                "SELECT 1 FROM analysis.pipeline_jobs WHERE job_id = ANY($1) FOR KEY SHARE",
                [waiting, ready],
            )
            assert await asyncio.wait_for(repo.settle_batch(), 3) == (1, 0, False)
            rows, _ = await asyncio.wait_for(repo.claim(_KIND, 10, 60), 3)
            assert {r["job_id"] for r in rows} == {ready, waiting}
    finally:
        await other.close()


async def test_two_instances_reaping_and_settling_neither_block_nor_deadlock(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        a, b = PipelineJobsRepository(pipeline_pg), PipelineJobsRepository(other)
        for i in range(30):
            job_id = await insert_pipeline_job(pipeline_pg, subject=f"RUN{i}", state="running")
            await shift_pipeline_job(pipeline_pg, job_id, lease_expires_at=-1)
            parent = await insert_pipeline_job(pipeline_pg, subject=f"W{i}", state="waiting")
            child = await insert_pipeline_job(pipeline_pg, subject=f"D{i}", state="succeeded")
            await _edge(pipeline_pg, parent, child)
        results = await asyncio.wait_for(
            asyncio.gather(a.reap(5), b.reap(5), a.settle_batch(), b.settle_batch()), _GUARD_S
        )
        (ra, _), (rb, _), (sa, _, _), (sb, _, _) = results
        assert ra + rb == 30 and sa + sb == 30
    finally:
        await other.close()


class _DeletingHandle:
    """Wraps a transaction handle; deletes the row on another connection after the first read."""

    def __init__(self, conn, other_pool, job_id):
        self._conn, self._other, self._job_id, self._calls = conn, other_pool, job_id, 0

    async def fetchval(self, query, *args):
        value = await self._conn.fetchval(query, *args)
        self._calls += 1
        if self._calls == 1:
            await self._other.execute(
                "DELETE FROM analysis.pipeline_jobs WHERE job_id = $1", self._job_id
            )
        return value


async def test_enqueue_retries_once_when_the_existing_row_vanishes(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        repo = PipelineJobsRepository(pipeline_pg)
        existing = await insert_pipeline_job(pipeline_pg)
        async with pipeline_pg.acquire() as c, c.transaction():
            job_id, created = await repo.enqueue(
                "probe",
                "AAPL",
                "2026-11-27",
                run_id="run-x",
                lane=10,
                conn=_DeletingHandle(c, other, existing),
            )
        assert created is True and job_id != existing
        assert (await _row(pipeline_pg, job_id))["run_id"] == "run-x"
    finally:
        await other.close()


class _NoPool:
    async def acquire(self, timeout):
        raise AssertionError("no statement may be issued")


async def test_empty_claim_and_empty_heartbeat_issue_no_statement():
    repo = PipelineJobsRepository(_NoPool())
    assert await repo.claim([], 4, 60) == ([], None)
    assert await repo.heartbeat([], 60) == (set(), None)


async def test_report_retry_delay_and_error_are_written(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    job_id = await insert_pipeline_job(pipeline_pg)
    held = await _claim_one(repo, job_id)
    await repo.report(
        job_id, held["lease_token"], "transient", max_attempts=5, retry_delay_s=30, error="x" * 10
    )
    delay = await pipeline_pg.fetchval(
        "SELECT EXTRACT(EPOCH FROM next_attempt_at - now()) FROM analysis.pipeline_jobs "
        "WHERE job_id = $1",
        job_id,
    )
    assert 25 < delay <= 30
    assert (await _row(pipeline_pg, job_id))["last_error"] == "x" * 10


async def test_heartbeat_renews_only_matching_running_pairs(pipeline_pg):
    repo = PipelineJobsRepository(pipeline_pg)
    job_id = await insert_pipeline_job(pipeline_pg)
    held = await _claim_one(repo, job_id, lease_seconds=45)
    renewed, sent = await repo.heartbeat(
        [(job_id, held["lease_token"]), (job_id + 999, held["lease_token"])], 300
    )
    assert renewed == {(job_id, held["lease_token"])} and sent is not None
    left = await pipeline_pg.fetchval(
        "SELECT EXTRACT(EPOCH FROM lease_expires_at - now()) FROM analysis.pipeline_jobs "
        "WHERE job_id = $1",
        job_id,
    )
    assert left > 250


async def test_check_constraints_reject_inconsistent_rows(pipeline_pg):
    with pytest.raises(apg.CheckViolationError):
        await insert_pipeline_job(pipeline_pg, state="running", lease_token=None)
    with pytest.raises(apg.CheckViolationError):
        await insert_pipeline_job(pipeline_pg, subject="B", state="blocked", verdict=None)
