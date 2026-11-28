"""Feature 367 retention prune end to end: FR-7, @AC-12, @AC-15, @AC-18."""

import asyncio
import time
from contextlib import asynccontextmanager
from datetime import date

import pytest

from app.engine.job_graph import (
    PRUNE_KIND,
    HandlerRegistry,
    JobGraphSettings,
    JobGraphWorker,
    Succeeded,
)
from app.jobs import build_registry, retention_prune
from app.jobs.retention_prune import PRUNE_BLOCK_BUDGET_S, PRUNE_SELF_STOP_S, make_handler
from app.repositories.pipeline_jobs import BATCH_SIZE, PipelineJobsRepository
from tests.conftest import (
    insert_pipeline_job,
    pipeline_pool,
    shift_pipeline_job,
    snapshot_watcher,
)

pytestmark = pytest.mark.real_pg

DAY = date(2026, 11, 27)
_DAY_S = 86400
_GUARD_S = 15


def _settings(retention_days=7):
    return JobGraphSettings(snapshot_watcher(**{"pipeline.retention_days": retention_days}))


def _worker(pool, settings, *, today=DAY, registry=None):
    return JobGraphWorker(
        PipelineJobsRepository(pool),
        pool,
        settings,
        registry or build_registry(settings),
        utc_today=lambda: today,
    )


async def _drain(*workers):
    deadline = time.monotonic() + _GUARD_S
    while any(w._attempts for w in workers):
        assert time.monotonic() < deadline, "attempts did not finish"
        await asyncio.sleep(0.02)
    await asyncio.sleep(0.05)


async def _run_prune(worker):
    await worker.maintenance_tick()
    await worker.claim_tick()
    await _drain(worker)


async def _aged(pool, state, days, **fields):
    job_id = await insert_pipeline_job(pool, state=state, **fields)
    await shift_pipeline_job(pool, job_id, finished_at=-days * _DAY_S)
    return job_id


async def _prune_jobs(pool):
    return await pool.fetch(
        "SELECT * FROM analysis.pipeline_jobs WHERE kind = $1 ORDER BY job_id", PRUNE_KIND
    )


async def _exists(pool, job_id):
    return await pool.fetchval(
        "SELECT EXISTS (SELECT 1 FROM analysis.pipeline_jobs WHERE job_id = $1)", job_id
    )


async def _bulk_aged(pool, state, n, days):
    await pool.execute(
        f"""
INSERT INTO analysis.pipeline_jobs (kind, subject, epoch, run_id, lane, state, next_attempt_at,
                                    finished_at)
SELECT 'probe', 'bulk-' || g, 'e', 'r', 10, '{state}', now(),
       now() - make_interval(days => {int(days)})
  FROM generate_series(1, {int(n)}) g
"""
    )


async def _count(pool, state):
    return await pool.fetchval(
        "SELECT count(*) FROM analysis.pipeline_jobs WHERE state = $1 AND kind = 'probe'", state
    )


async def test_ac12_succeeded_rows_are_pruned_after_retention_days_and_terminal_rows_kept(
    pipeline_pg,
):
    ids = {s: await _aged(pipeline_pg, s, 8, subject=s) for s in ("succeeded", "failed", "dead")}
    ids["blocked"] = await _aged(pipeline_pg, "blocked", 8, subject="blocked")
    await _run_prune(_worker(pipeline_pg, _settings(7)))
    assert not await _exists(pipeline_pg, ids["succeeded"])
    for state in ("failed", "dead", "blocked"):
        assert await _exists(pipeline_pg, ids[state])
    (job,) = await _prune_jobs(pipeline_pg)
    assert (job["state"], job["subject"], job["epoch"]) == ("succeeded", "global", "2026-11-27")


async def test_ac18_dead_rows_are_pruned_after_thirty_one_days(pipeline_pg):
    old = await _aged(pipeline_pg, "dead", 31, subject="OLD")
    young = await _aged(pipeline_pg, "dead", 29, subject="YOUNG")
    await _run_prune(_worker(pipeline_pg, _settings(7)))
    assert not await _exists(pipeline_pg, old) and await _exists(pipeline_pg, young)


async def test_ac18_a_longer_retention_also_keeps_terminal_rows_longer(pipeline_pg):
    kept = await _aged(pipeline_pg, "dead", 40, subject="KEPT")
    await _run_prune(_worker(pipeline_pg, _settings(45)))
    assert await _exists(pipeline_pg, kept)


async def test_ac15_two_instances_ensure_one_prune_job_and_it_runs_once(pipeline_pg, local_pg):
    other = await pipeline_pool(local_pg)
    try:
        a, b = _worker(pipeline_pg, _settings()), _worker(other, _settings())
        await asyncio.wait_for(asyncio.gather(a.maintenance_tick(), b.maintenance_tick()), _GUARD_S)
        (job,) = await _prune_jobs(pipeline_pg)
        assert job["epoch"] == "2026-11-27" and job["run_id"] == "retention_prune:2026-11-27"
        await asyncio.wait_for(asyncio.gather(a.claim_tick(), b.claim_tick()), _GUARD_S)
        await _drain(a, b)
        (job,) = await _prune_jobs(pipeline_pg)
        assert (job["state"], job["attempts"]) == ("succeeded", 1)
    finally:
        await other.close()


async def test_fr7_a_child_of_an_unfinished_parent_is_kept_until_the_parent_finishes(
    pipeline_pg,
):
    child = await _aged(pipeline_pg, "succeeded", 8, subject="CHILD")
    parent = await insert_pipeline_job(pipeline_pg, subject="PARENT", state="waiting")
    await pipeline_pg.execute(
        "INSERT INTO analysis.pipeline_job_deps (parent_id, child_id) VALUES ($1, $2)",
        parent,
        child,
    )
    await _run_prune(_worker(pipeline_pg, _settings(7)))
    assert await _exists(pipeline_pg, child)
    await pipeline_pg.execute(
        "UPDATE analysis.pipeline_jobs SET state = 'succeeded', finished_at = now() "
        "WHERE job_id = $1",
        parent,
    )
    await shift_pipeline_job(pipeline_pg, parent, finished_at=-8 * _DAY_S)
    await _run_prune(_worker(pipeline_pg, _settings(7), today=date(2026, 11, 28)))
    assert not await _exists(pipeline_pg, child) and not await _exists(pipeline_pg, parent)


async def test_the_handler_stops_after_its_self_stop_and_still_succeeds(pipeline_pg):
    await _bulk_aged(pipeline_pg, "failed", BATCH_SIZE + 100, 45)
    clock = iter([0.0, 0.0])

    def fake():
        return next(clock, PRUNE_SELF_STOP_S + 1)

    settings = _settings(7)
    reg = HandlerRegistry()
    reg.register(PRUNE_KIND, make_handler(settings, monotonic=fake), child_kinds=())
    await _run_prune(_worker(pipeline_pg, settings, registry=reg))
    assert await _count(pipeline_pg, "failed") == 100
    (job,) = await _prune_jobs(pipeline_pg)
    assert job["state"] == "succeeded"


async def test_more_than_one_batch_of_rows_is_pruned_in_one_run(pipeline_pg):
    await _bulk_aged(pipeline_pg, "succeeded", 2 * BATCH_SIZE + 100, 8)
    await _run_prune(_worker(pipeline_pg, _settings(7)))
    assert await _count(pipeline_pg, "succeeded") == 0


async def test_a_pruned_key_can_be_enqueued_again(pipeline_pg):
    await _aged(pipeline_pg, "succeeded", 8, subject="AGAIN")
    await _run_prune(_worker(pipeline_pg, _settings(7)))
    repo = PipelineJobsRepository(pipeline_pg)
    _, created = await repo.enqueue("probe", "AGAIN", "2026-11-27", run_id="r2", lane=10)
    assert created is True


class _RecordingJob:
    def __init__(self):
        self.budgets: list[float] = []

    @asynccontextmanager
    async def db(self, budget):
        self.budgets.append(budget)
        yield object()


async def test_every_batch_opens_its_own_block_at_the_block_budget(monkeypatch):
    calls = []

    async def fake_prune_batch(*, conn, state, older_than_days, cutoff=None):
        calls.append((state, older_than_days, cutoff))
        full = state == "succeeded" and sum(c[0] == "succeeded" for c in calls) < 3
        return BATCH_SIZE, BATCH_SIZE, cutoff or f"cutoff-{state}", full

    monkeypatch.setattr(retention_prune, "prune_batch", fake_prune_batch)
    job = _RecordingJob()
    assert await make_handler(_settings(7))(job) == Succeeded()
    assert len(job.budgets) == len(calls) == 6
    assert set(job.budgets) == {PRUNE_BLOCK_BUDGET_S}
    assert [c[0] for c in calls] == ["failed", "dead", "blocked", *["succeeded"] * 3]
    assert [c[2] for c in calls[3:]] == [None, "cutoff-succeeded", "cutoff-succeeded"]
    assert [c[1] for c in calls] == [*[retention_prune.TERMINAL_KEEP_MIN_DAYS] * 3, 7, 7, 7]
