"""Feature 367 worker runtime on a fake repository and virtual time (no database, no sleeps)."""

import asyncio
import logging
from datetime import date

import pytest
from gen.config.v1 import config_pb2

from app import supervision
from app.engine import job_graph
from app.engine.job_graph import (
    AttemptStopped,
    Child,
    HandlerRegistry,
    JobGraphSettings,
    JobGraphWorker,
    Succeeded,
    WaitOn,
)
from app.repositories.pipeline_jobs import ParkRace, PipelineJobsRepository
from tests.conftest import FakeJobRepo, snapshot_watcher

DAY = date(2026, 11, 27)


class _FakeConn:
    def __init__(self):
        self.block: asyncio.Future | None = None
        self.terminated = False

    async def execute(self, query, *args):
        return "COMMIT" if query == "COMMIT" else "OK"

    async def fetchval(self, query, *args):
        if self.block is not None:
            return await self.block
        return 1

    def terminate(self):
        self.terminated = True
        if self.block is not None and not self.block.done():
            self.block.set_exception(ConnectionError("terminated"))


class _FakePool:
    def __init__(self):
        self.conn = _FakeConn()

    async def acquire(self, timeout):
        return self.conn

    async def release(self, con, timeout):
        pass


@pytest.fixture
async def bg():
    tasks: list[asyncio.Task] = []
    yield tasks
    for t in [*tasks, *supervision._BACKGROUND_TASKS]:
        if t.get_name().startswith("pipeline-") or t in tasks:
            t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


def _settings(**values):
    w = snapshot_watcher(**values)
    return w, JobGraphSettings(w)


def _set(watcher, key, value):
    v = watcher._snapshot.values[key]
    if isinstance(value, bool):
        v.bool_val = value
    else:
        v.int_val = value


def _registry(handler, *, kinds=("probe",), children=()):
    reg = HandlerRegistry()
    for kind in kinds:
        reg.register(kind, handler, child_kinds=children if kind == "parent" else ())
    return reg


def _worker(vt, repo, settings, handler, *, pool=None, registry=None, today=DAY):
    return JobGraphWorker(
        repo,
        pool or _FakePool(),
        settings,
        registry or _registry(handler),
        monotonic=lambda: vt.now,
        utc_today=lambda: today,
        rand=lambda: 0.0,
    )


def _loops(worker, bg, *which):
    for name in which:
        bg.append(asyncio.create_task(getattr(worker, f"run_{name}_forever")()))


def _gated():
    gate = asyncio.Event()
    calls = []

    async def handler(job):
        calls.append(job.job_id)
        await gate.wait()
        return Succeeded()

    return gate, calls, handler


# ---------------------------------------------------------------- config wiring


@pytest.mark.parametrize("listening", [True, False])
async def test_raising_concurrency_wakes_a_claim_loop_only_after_start_listening(
    virtual_time, bg, listening
):
    repo = FakeJobRepo(lambda: virtual_time.now)
    first, second = repo.add(subject="A"), repo.add(subject="B")
    watcher, settings = _settings(**{"pipeline.worker_concurrency": 1})
    gate, calls, handler = _gated()
    worker = _worker(virtual_time, repo, settings, handler)
    if listening:
        worker.start_listening()
    _loops(worker, bg, "claim")
    await virtual_time.advance(2)
    assert calls == [first]
    snap = config_pb2.ConfigSnapshot(namespace="analysis", version="v2")
    snap.values["pipeline.worker_concurrency"].int_val = 2
    watcher._apply(snap)
    await virtual_time.advance(2)
    assert (second in calls) is listening
    gate.set()


# ---------------------------------------------------------------- kill switch


async def test_ac14_disabled_worker_issues_no_statement(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    job_id = repo.add()
    _, settings = _settings(**{"pipeline.worker_enabled": False})
    worker = _worker(virtual_time, repo, settings, _gated()[2])
    _loops(worker, bg, "claim", "maintenance")
    await virtual_time.advance(10)
    assert repo.calls == []
    assert (repo.jobs[job_id]["state"], repo.jobs[job_id]["attempts"]) == ("ready", 0)


async def test_ac16_disabled_worker_does_not_enqueue_the_daily_prune(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    _, settings = _settings(**{"pipeline.worker_enabled": False})
    worker = _worker(virtual_time, repo, settings, _gated()[2])
    _loops(worker, bg, "claim", "maintenance")
    await virtual_time.advance(10)
    assert "enqueue" not in repo.calls
    assert not any(j["kind"] == job_graph.PRUNE_KIND for j in repo.jobs.values())


async def test_ac17_running_job_reports_after_disable_and_no_new_job_is_claimed(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    first = repo.add(subject="A")
    watcher, settings = _settings()
    gate, calls, handler = _gated()
    worker = _worker(virtual_time, repo, settings, handler)
    _loops(worker, bg, "claim", "heartbeat")
    await virtual_time.advance(1)
    assert calls == [first]
    second = repo.add(subject="B")
    _set(watcher, "pipeline.worker_enabled", False)
    gate.set()
    await virtual_time.advance(20)
    assert repo.jobs[first]["state"] == "succeeded"
    assert (repo.jobs[second]["state"], repo.jobs[second]["attempts"]) == ("ready", 0)


# ---------------------------------------------------------------- takeover


async def test_ac3_a_stopped_holder_is_taken_over_within_lease_plus_ten_seconds(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    job_id = repo.add()
    _, settings = _settings()
    gate, calls, handler = _gated()
    dead = _worker(virtual_time, repo, settings, handler)
    assert await dead.claim_tick() >= 0
    claimed_at = virtual_time.now
    first_token = repo.jobs[job_id]["lease_token"]
    live = _worker(virtual_time, repo, settings, handler)
    _loops(live, bg, "claim", "maintenance", "heartbeat")
    taken_at = None
    for _ in range(80):
        await virtual_time.advance(1)
        j = repo.jobs[job_id]
        if j["state"] == "running" and j["lease_token"] != first_token:
            taken_at = virtual_time.now
            break
    assert taken_at is not None and taken_at - claimed_at <= 60 + 10 + 4
    assert repo.jobs[job_id]["attempts"] == 2
    gate.set()


# ---------------------------------------------------------------- stop path


async def test_stop_inside_a_db_block_aborts_it_and_refuses_a_new_block(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add()
    pool = _FakePool()
    pool.conn.block = asyncio.get_running_loop().create_future()
    seen = []

    async def handler(job):
        try:
            async with job.db(5) as conn:
                await conn.fetchval("SELECT 1")
        except AttemptStopped:
            seen.append("stopped")
        try:
            async with job.db(5):
                pass
        except AttemptStopped:
            seen.append("refused")
            raise

    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, handler, pool=pool)
    await worker.claim_tick()
    await virtual_time.advance(1)
    repo.jobs[1]["lease_token"] = None  # the lease was taken: the next heartbeat omits the pair
    repo.jobs[1]["state"] = "ready"
    await worker.heartbeat_tick()
    await virtual_time.advance(1)
    assert pool.conn.terminated and seen == ["stopped", "refused"]
    assert "report" not in repo.calls and worker._attempts == {}


async def test_unresponsive_handler_keeps_its_slot_until_its_task_ends(virtual_time, bg, caplog):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add()
    release = asyncio.Event()

    async def stubborn(job):
        while not release.is_set():
            try:
                await release.wait()
            except asyncio.CancelledError:
                continue
        return Succeeded()

    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, stubborn)
    await worker.claim_tick()
    await virtual_time.advance(1)
    repo.jobs[1]["lease_token"] = None
    with caplog.at_level(logging.ERROR, logger="app.engine.job_graph"):
        await worker.heartbeat_tick()
        await virtual_time.advance(12)
    assert any("abandoned" in r.getMessage() for r in caplog.records)
    assert worker._limiter.in_use == 1
    release.set()
    await virtual_time.advance(2)
    assert worker._limiter.in_use == 0 and "report" not in repo.calls


async def test_an_attempt_retrying_its_report_keeps_its_slot(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add()
    repo.fail["report"] = [OSError("down")] * 3

    async def handler(job):
        return Succeeded()

    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, handler)
    _loops(worker, bg, "heartbeat")
    await worker.claim_tick()
    await virtual_time.advance(2.5)
    assert worker._limiter.in_use == 1 and repo.calls.count("report") >= 2
    await virtual_time.advance(10)
    assert repo.jobs[1]["state"] == "succeeded" and worker._limiter.in_use == 0


async def test_blocked_claim_loop_claims_nothing_once_disabled_and_freed(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add(subject="A")
    watcher, settings = _settings(**{"pipeline.worker_concurrency": 1})
    gate, calls, handler = _gated()
    worker = _worker(virtual_time, repo, settings, handler)
    _loops(worker, bg, "claim", "heartbeat")
    await virtual_time.advance(1)
    second = repo.add(subject="B")
    _set(watcher, "pipeline.worker_enabled", False)
    gate.set()
    await virtual_time.advance(15)
    assert repo.jobs[second]["state"] == "ready" and repo.calls.count("claim") == 1


async def test_a_job_claimed_after_the_lease_is_lowered_is_renewed_before_its_fence(
    virtual_time, bg
):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add()
    watcher, settings = _settings()
    _set(watcher, "pipeline.lease_seconds", 45)
    gate, calls, handler = _gated()
    worker = _worker(virtual_time, repo, settings, handler)
    _loops(worker, bg, "claim", "heartbeat")
    await virtual_time.advance(60)
    (att,) = worker._attempts.values()
    assert att.stop is None and att.fence_deadline > virtual_time.now
    assert repo.jobs[1]["state"] == "running"
    gate.set()


async def test_claim_delay_sequence(virtual_time):
    repo = FakeJobRepo(lambda: virtual_time.now)
    _, settings = _settings(**{"pipeline.worker_concurrency": 2})
    gate, _, handler = _gated()
    worker = _worker(virtual_time, repo, settings, handler)
    assert [await worker.claim_tick() for _ in range(5)] == [1.0, 2.0, 4.0, 5.0, 5.0]
    repo.add(subject="A")
    assert await worker.claim_tick() == 1.0  # some free slots filled
    repo.add(subject="B")
    gate.set()
    await virtual_time.advance(1)
    repo.add(subject="C")
    assert await worker.claim_tick() in (0.0, 1.0)
    assert await worker.claim_tick() == 1.0  # the idle ladder restarts at poll_interval_ms


async def test_all_free_slots_filled_claims_again_at_once(virtual_time):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add(subject="A")
    repo.add(subject="B")
    _, settings = _settings(**{"pipeline.worker_concurrency": 2})
    gate, _, handler = _gated()
    worker = _worker(virtual_time, repo, settings, handler)
    assert await worker.claim_tick() == 0.0
    gate.set()


async def test_park_race_reruns_the_park_and_not_the_handler(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add(kind="parent")
    repo.fail["park"] = [ParkRace("child pruned")]
    runs = []

    async def handler(job):
        runs.append(job.kind)
        return WaitOn((Child("child", "C", "2026-11-27"),)) if job.kind == "parent" else Succeeded()

    _, settings = _settings()
    reg = _registry(handler, kinds=("parent", "child"), children=("child",))
    worker = _worker(virtual_time, repo, settings, handler, registry=reg)
    _loops(worker, bg, "heartbeat")
    await worker.claim_tick()
    await virtual_time.advance(5)
    assert runs == ["parent"] and repo.calls.count("park") == 2
    assert repo.jobs[1]["state"] == "waiting"


async def test_report_give_up_counts_once_and_drops_the_key(virtual_time, bg, caplog):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add()
    repo.fail["report"] = [OSError("down")] * 1000

    async def handler(job):
        return Succeeded()

    _, settings = _settings(**{"pipeline.lease_seconds": 600})
    worker = _worker(virtual_time, repo, settings, handler)
    _loops(worker, bg, "heartbeat")
    with caplog.at_level(logging.ERROR, logger="app.engine.job_graph"):
        await worker.claim_tick()
        await virtual_time.advance(320)
    gave_up = [r for r in caplog.records if "not written within" in r.getMessage()]
    assert len(gave_up) == 1 and worker._attempts == {} and worker._limiter.in_use == 0


async def test_committed_heartbeat_omitting_a_reporting_attempt_declares_no_loss(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add()
    gate, _, handler = _gated()
    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, handler)
    await worker.claim_tick()
    await virtual_time.advance(0.1)
    (att,) = worker._attempts.values()
    repo.delay["heartbeat"] = 2
    repo.omit_renewals = True
    hb = asyncio.create_task(worker.heartbeat_tick())
    bg.append(hb)
    await virtual_time.advance(0.5)
    gate.set()
    await virtual_time.advance(5)
    assert not att.lost.is_set() and repo.jobs[1]["state"] == "succeeded"


# ---------------------------------------------------------------- lane invariants


async def test_lane_queue_is_at_most_slots_held_plus_two(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    for n in range(4):
        repo.add(subject=f"S{n}")
    repo.delay["report"] = 2

    async def handler(job):
        return Succeeded()

    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, handler)
    _loops(worker, bg, "claim", "maintenance", "heartbeat")
    await virtual_time.advance(30)
    assert repo.lane_queue_max <= 4 + 2
    assert all(j["state"] == "succeeded" for j in repo.jobs.values() if j["kind"] == "probe")


class _HangingConn:
    def __init__(self):
        self.terminated = asyncio.Event()

    async def execute(self, query, *args):
        if query.startswith("BEGIN"):
            return "OK"
        await self.terminated.wait()
        raise ConnectionError("terminated")

    fetch = fetchval = fetchrow = execute

    def terminate(self):
        self.terminated.set()


class _HangingPool:
    async def acquire(self, timeout):
        return _HangingConn()

    async def release(self, con, timeout):
        pass


async def test_a_control_lane_operation_lasts_at_most_eight_seconds(virtual_time):
    repo = PipelineJobsRepository(_HangingPool(), monotonic=lambda: virtual_time.now)
    task = asyncio.create_task(repo.reap(5))
    start = virtual_time.now
    await virtual_time.advance(8)
    assert task.done() and isinstance(task.exception(), Exception)
    assert virtual_time.now - start <= 8


async def test_a_runner_holds_the_lane_at_most_fourteen_seconds(virtual_time, bg):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.add()
    gate, _, handler = _gated()
    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, handler)
    await worker.claim_tick()
    await virtual_time.advance(0.1)
    repo.delay["heartbeat"] = 100
    repo.delay["report"] = 8
    bg.append(asyncio.create_task(worker.heartbeat_tick()))
    await virtual_time.advance(0.5)
    gate.set()
    await virtual_time.advance(0.1)
    started = virtual_time.now
    await virtual_time.advance(14)
    assert repo.jobs[1]["state"] == "succeeded" and virtual_time.now - started <= 14
    assert not repo._lane.locked()


async def test_maintenance_tick_bounds_its_lane_operations(virtual_time):
    repo = FakeJobRepo(lambda: virtual_time.now)
    real_settle = repo.settle_batch

    async def full_settle(*, conn=None):
        await real_settle()
        return 0, 500, True

    repo.settle_batch = full_settle
    repo.delay["settle_batch"] = 0.3
    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, _gated()[2])
    task = asyncio.create_task(worker.maintenance_tick())
    await virtual_time.advance(30)
    assert task.done()
    settles = repo.calls.count("settle_batch")
    others = [c for c in repo.calls if c != "settle_batch"]
    assert 1 <= settles <= job_graph.SETTLE_MAX_BATCHES and len(others) <= 3
    repo.calls.clear()
    repo.delay["settle_batch"] = 1.0
    task = asyncio.create_task(worker.maintenance_tick())
    await virtual_time.advance(30)
    assert repo.calls.count("settle_batch") <= 9  # none queued once 8 s have passed


async def test_idle_claim_delay_never_exceeds_five_seconds(virtual_time):
    repo = FakeJobRepo(lambda: virtual_time.now)
    _, settings = _settings(**{"pipeline.poll_interval_ms": 5000})
    worker = _worker(virtual_time, repo, settings, _gated()[2])
    assert max([await worker.claim_tick() for _ in range(6)]) <= 5.0


# ---------------------------------------------------------------- daily ensure


async def test_daily_prune_is_ensured_once_per_day_and_again_by_a_new_worker(virtual_time):
    repo = FakeJobRepo(lambda: virtual_time.now)
    _, settings = _settings()
    today = [DAY]
    worker = JobGraphWorker(
        repo,
        _FakePool(),
        settings,
        _registry(_gated()[2]),
        monotonic=lambda: virtual_time.now,
        utc_today=lambda: today[0],
    )
    for _ in range(3):
        await worker.maintenance_tick()
    assert repo.calls.count("enqueue") == 1
    today[0] = date(2026, 11, 28)
    await worker.maintenance_tick()
    assert repo.calls.count("enqueue") == 2
    fresh = _worker(virtual_time, repo, settings, _gated()[2], today=date(2026, 11, 28))
    await fresh.maintenance_tick()
    assert repo.calls.count("enqueue") == 3
    prunes = [j for j in repo.jobs.values() if j["kind"] == job_graph.PRUNE_KIND]
    assert [(j["subject"], j["epoch"], j["lane"]) for j in prunes] == [
        ("global", "2026-11-27", 10),
        ("global", "2026-11-28", 10),
    ]


async def test_daily_ensure_marker_is_not_set_when_the_ensure_fails(virtual_time):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.fail["enqueue"] = [OSError("down")]
    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, _gated()[2])
    await worker.maintenance_tick()
    await worker.maintenance_tick()
    assert repo.calls.count("enqueue") == 2
    assert sum(j["kind"] == job_graph.PRUNE_KIND for j in repo.jobs.values()) == 1


async def test_one_failing_maintenance_step_does_not_skip_the_others(virtual_time):
    repo = FakeJobRepo(lambda: virtual_time.now)
    repo.fail["reap"] = [OSError("down")]
    _, settings = _settings()
    worker = _worker(virtual_time, repo, settings, _gated()[2])
    await worker.maintenance_tick()
    assert repo.calls == ["reap", "settle_batch", "enqueue", "ready_stats"]
    repo.calls.clear()
    await worker.maintenance_tick()
    await worker.maintenance_tick()
    assert "ready_stats" not in repo.calls  # stats run on ticks 1, 4, 7, ...
