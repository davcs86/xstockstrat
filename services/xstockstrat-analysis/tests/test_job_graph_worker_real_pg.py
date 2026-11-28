"""Feature 367 worker runtime against a real PostgreSQL: handlers, parks and the one-tick settle."""

import asyncio
import time

import pytest

from app.engine.job_graph import (
    Child,
    HandlerRegistry,
    JobGraphSettings,
    JobGraphWorker,
    PermanentJobError,
    Succeeded,
    Verdict,
    WaitOn,
)
from app.repositories.pipeline_jobs import PipelineJobsRepository
from tests.conftest import (
    insert_pipeline_job,
    pipeline_pool,
    seed_blocked_parents,
    snapshot_watcher,
)

pytestmark = pytest.mark.real_pg

_GUARD_S = 15


def _worker(pool, registry, **values):
    settings = JobGraphSettings(snapshot_watcher(**values))
    return JobGraphWorker(PipelineJobsRepository(pool), pool, settings, registry, rand=lambda: 0.0)


async def _drain(*workers):
    deadline = time.monotonic() + _GUARD_S
    while any(w._attempts for w in workers):
        assert time.monotonic() < deadline, "attempts did not finish"
        await asyncio.sleep(0.02)
    await asyncio.sleep(0.05)


async def _state(pool, job_id):
    return await pool.fetchrow("SELECT * FROM analysis.pipeline_jobs WHERE job_id = $1", job_id)


def _probe(handler):
    reg = HandlerRegistry()
    reg.register("probe", handler)
    return reg


def _graph(parent, child):
    reg = HandlerRegistry()
    reg.register("parent", parent, child_kinds=("child",))
    reg.register("child", child)
    return reg


async def test_ac2_two_workers_run_one_ready_job_once(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        runs = []

        async def handler(job):
            runs.append(job.job_id)
            await asyncio.sleep(0.05)
            return Succeeded()

        job_id = await insert_pipeline_job(pipeline_pg)
        a, b = _worker(pipeline_pg, _probe(handler)), _worker(other, _probe(handler))
        await asyncio.wait_for(asyncio.gather(a.claim_tick(), b.claim_tick()), _GUARD_S)
        await _drain(a, b)
        assert runs == [job_id]
        assert (await _state(pipeline_pg, job_id))["state"] == "succeeded"
    finally:
        await other.close()


def _parent_child(runs, child_outcome):
    async def parent(job):
        runs.append(("parent", job.wait_round))
        if job.wait_round == 0:
            return WaitOn((Child("child", "C", "2026-11-27"),))
        return Succeeded()

    async def child(job):
        runs.append(("child", job.wait_round))
        return child_outcome

    return _graph(parent, child)


async def test_ac8_parked_parent_runs_again_after_its_child_succeeds(pipeline_pg):
    runs = []
    worker = _worker(pipeline_pg, _parent_child(runs, Succeeded()))
    parent = await insert_pipeline_job(pipeline_pg, kind="parent")
    for _ in range(2):
        await worker.claim_tick()
        await _drain(worker)
    await worker.maintenance_tick()
    await worker.claim_tick()
    await _drain(worker)
    assert runs == [("parent", 0), ("child", 0), ("parent", 1)]
    row = await _state(pipeline_pg, parent)
    assert (row["state"], row["wait_round"]) == ("succeeded", 1)


async def test_ac9_child_verdict_blocks_the_parent_without_rerunning_it(pipeline_pg):
    runs = []
    worker = _worker(pipeline_pg, _parent_child(runs, Verdict("no_vendor_data")))
    parent = await insert_pipeline_job(pipeline_pg, kind="parent")
    for _ in range(2):
        await worker.claim_tick()
        await _drain(worker)
    await worker.maintenance_tick()
    await worker.claim_tick()
    await _drain(worker)
    assert runs == [("parent", 0), ("child", 0)]
    row = await _state(pipeline_pg, parent)
    assert (row["state"], row["verdict"]) == ("blocked", "no_vendor_data")


async def test_a_runner_that_waited_for_an_inflight_heartbeat_records_no_false_loss(
    pipeline_pg, local_pg
):
    gate = asyncio.Event()

    async def handler(job):
        await gate.wait()
        return Succeeded()

    job_id = await insert_pipeline_job(pipeline_pg)
    worker = _worker(pipeline_pg, _probe(handler))
    await worker.claim_tick()
    await asyncio.sleep(0.05)
    (att,) = worker._attempts.values()
    blocker = await pipeline_pool(local_pg, 1)
    try:
        async with blocker.acquire() as c:
            tr = c.transaction()
            await tr.start()
            await c.execute(
                "SELECT 1 FROM analysis.pipeline_jobs WHERE job_id = $1 FOR UPDATE", job_id
            )
            hb = asyncio.create_task(worker.heartbeat_tick())
            await asyncio.sleep(0.2)
            assert worker._inflight is not None and not hb.done()
            gate.set()
            await asyncio.sleep(0.3)
            assert att.phase == "reporting" and not hb.done()
            await tr.commit()
        await asyncio.wait_for(hb, _GUARD_S)
        await _drain(worker)
    finally:
        await blocker.close()
    assert not att.lost.is_set()
    assert (await _state(pipeline_pg, job_id))["state"] == "succeeded"


async def test_ac6_permanent_error_fails_and_ac5_transient_error_retries_after_five_seconds(
    pipeline_pg,
):
    before = {}

    async def handler(job):
        async with job.db(5) as conn:
            before[job.subject] = await conn.fetchval("SELECT now()")
        if job.subject == "PERM":
            raise PermanentJobError("bad input")
        raise RuntimeError("vendor timeout")

    perm = await insert_pipeline_job(pipeline_pg, subject="PERM")
    trans = await insert_pipeline_job(pipeline_pg, subject="TRANS")
    worker = _worker(pipeline_pg, _probe(handler))
    await worker.claim_tick()
    await _drain(worker)
    row = await _state(pipeline_pg, perm)
    assert (row["state"], row["error_class"]) == ("failed", "permanent")
    assert "bad input" in row["last_error"]
    row = await _state(pipeline_pg, trans)
    assert (row["state"], row["error_class"], row["attempts"]) == ("ready", "transient", 1)
    assert (row["next_attempt_at"] - before["TRANS"]).total_seconds() >= 5


async def test_ac7_a_fifth_transient_failure_ends_dead_and_is_never_claimed_again(pipeline_pg):
    async def handler(job):
        raise RuntimeError("still broken")

    job_id = await insert_pipeline_job(pipeline_pg, attempts=4)
    worker = _worker(pipeline_pg, _probe(handler))
    await worker.claim_tick()
    await _drain(worker)
    row = await _state(pipeline_pg, job_id)
    assert (row["state"], row["error_class"], row["attempts"]) == ("dead", "transient", 5)
    await pipeline_pg.execute(
        "UPDATE analysis.pipeline_jobs SET next_attempt_at = now() - interval '1 hour'"
    )
    await worker.claim_tick()
    assert worker._attempts == {}


async def test_one_maintenance_tick_settles_twelve_hundred_parents(pipeline_pg):
    await seed_blocked_parents(pipeline_pg, 1200)
    worker = _worker(pipeline_pg, _probe(lambda job: Succeeded()))
    await asyncio.wait_for(worker.maintenance_tick(), _GUARD_S)
    rows = await pipeline_pg.fetch(
        "SELECT state, verdict, count(*) FROM analysis.pipeline_jobs "
        "WHERE subject LIKE 'parent-%' GROUP BY 1, 2"
    )
    assert [tuple(r) for r in rows] == [("blocked", "dependency_dead", 1200)]
