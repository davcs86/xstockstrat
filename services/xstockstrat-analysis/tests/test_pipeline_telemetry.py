"""Feature 367 pipeline telemetry: @AC-4 and @AC-13 counts, tick records, labels, host.provider."""

import asyncio
import logging
import time

import pytest

from app import telemetry
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
from tests import test_telemetry
from tests.conftest import (
    FakeJobRepo,
    insert_pipeline_job,
    pipeline_pool,
    shift_pipeline_job,
    snapshot_watcher,
)

metric_reader = test_telemetry.metric_reader

_PIPELINE_INSTRUMENTS = {
    "analysis.pipeline.attempts",
    "analysis.pipeline.lease_events",
    "analysis.pipeline.db.duration",
    "analysis.pipeline.ready_depth",
    "analysis.pipeline.oldest_ready_age",
}
_GUARD_S = 15


def _points(reader, name):
    data = reader.get_metrics_data()
    return [
        p
        for rm in (data.resource_metrics if data else [])
        for sm in rm.scope_metrics
        for m in sm.metrics
        if m.name == name
        for p in m.data.data_points
    ]


def _sum(reader, name, outcome):
    return sum(
        p.value for p in _points(reader, name) if dict(p.attributes).get("outcome") == outcome
    )


def _worker(repo, pool, registry, **values):
    return JobGraphWorker(
        repo, pool, JobGraphSettings(snapshot_watcher(**values)), registry, rand=lambda: 0.0
    )


async def _drain(*workers):
    deadline = time.monotonic() + _GUARD_S
    while any(w._attempts for w in workers):
        assert time.monotonic() < deadline, "attempts did not finish"
        await asyncio.sleep(0.02)
    await asyncio.sleep(0.05)


def _probe(handler):
    reg = HandlerRegistry()
    reg.register("probe", handler)
    return reg


@pytest.mark.real_pg
async def test_ac13_ready_gauges_export_depth_and_age_per_lane(metric_reader, pipeline_pg):
    telemetry.register_pipeline_gauges()
    for i, age in enumerate((120, 60, 30, 1)):
        job_id = await insert_pipeline_job(pipeline_pg, subject=f"R{i}")
        await shift_pipeline_job(pipeline_pg, job_id, next_attempt_at=-age)
    worker = _worker(PipelineJobsRepository(pipeline_pg), pipeline_pg, _probe(None))
    await worker.stats_step()
    depth = {
        dict(p.attributes)["lane"]: p.value
        for p in _points(metric_reader, "analysis.pipeline.ready_depth")
    }
    age = {
        dict(p.attributes)["lane"]: p.value
        for p in _points(metric_reader, "analysis.pipeline.oldest_ready_age")
    }
    assert depth["watchlist"] == 4 and age["watchlist"] >= 120
    assert depth["held"] == 0
    telemetry.set_pipeline_ready_stats(
        {"watchlist": (4, 120.0)}, at=time.monotonic() - (telemetry.PIPELINE_STATS_STALE_S + 1)
    )
    assert _points(metric_reader, "analysis.pipeline.ready_depth") == []
    assert _points(metric_reader, "analysis.pipeline.oldest_ready_age") == []


@pytest.mark.real_pg
async def test_ac4_a_taken_over_job_counts_one_success_one_expiry_and_one_rejection(
    metric_reader, pipeline_pg, local_pg
):
    other = await pipeline_pool(local_pg)
    try:
        gate = asyncio.Event()

        async def stale(job):
            await gate.wait()
            return Succeeded()

        async def live(job):
            return Succeeded()

        job_id = await insert_pipeline_job(pipeline_pg)
        a = _worker(PipelineJobsRepository(pipeline_pg), pipeline_pg, _probe(stale))
        b = _worker(PipelineJobsRepository(other), other, _probe(live))
        await a.claim_tick()
        await shift_pipeline_job(pipeline_pg, job_id, lease_expires_at=-61)
        await b.maintenance_tick()
        await b.claim_tick()
        await _drain(b)
        gate.set()
        await _drain(a)
        assert _sum(metric_reader, "analysis.pipeline.attempts", "succeeded") == 1
        assert _sum(metric_reader, "analysis.pipeline.attempts", "expired") == 1
        assert _sum(metric_reader, "analysis.pipeline.lease_events", "report_rejected") == 1
    finally:
        await other.close()


async def test_each_transition_out_of_running_is_counted_once(metric_reader):
    repo = FakeJobRepo(time.monotonic)
    for subject, extra in (
        ("PARK", {"kind": "parent"}),
        ("VERDICT", {}),
        ("RETRY", {}),
        ("FAIL", {}),
        ("DEAD", {"attempts": 4}),
    ):
        repo.add(subject=subject, **extra)

    async def handler(job):
        if job.subject == "PARK":
            return WaitOn((Child("probe", "KID", "2026-11-27"),))
        if job.subject == "VERDICT":
            return Verdict("no_vendor_data")
        if job.subject == "FAIL":
            raise PermanentJobError("bad")
        if job.subject == "KID":
            await asyncio.Event().wait()
        raise RuntimeError("transient")

    reg = HandlerRegistry()
    reg.register("parent", handler, child_kinds=("probe",))
    reg.register("probe", handler)
    worker = _worker(repo, None, reg, **{"pipeline.worker_concurrency": 8})
    await worker.claim_tick()
    deadline = time.monotonic() + _GUARD_S
    while len(worker._attempts) > 0 and repo.calls.count("report") + repo.calls.count("park") < 5:
        assert time.monotonic() < deadline
        await asyncio.sleep(0.02)
    for outcome in ("parked", "blocked", "retried", "failed", "dead"):
        assert _sum(metric_reader, "analysis.pipeline.attempts", outcome) == 1, outcome


async def test_claim_tick_records_states_at_most_once_per_minute(virtual_time, caplog):
    repo = FakeJobRepo(lambda: virtual_time.now)
    watcher = snapshot_watcher()
    gate = asyncio.Event()

    async def handler(job):
        await gate.wait()
        return Succeeded()

    worker = JobGraphWorker(
        repo, None, JobGraphSettings(watcher), _probe(handler), monotonic=lambda: virtual_time.now
    )

    def ticks():
        return [
            r
            for r in caplog.records
            if r.getMessage() == telemetry.LOOP_TICK_OK and r.__dict__["loop"] == "pipeline_worker"
        ]

    with caplog.at_level(logging.INFO, logger="app.engine.job_graph"):
        repo.add()
        await worker.claim_tick()
        await worker.claim_tick()
        assert len(ticks()) == 1 and "state" not in ticks()[0].__dict__
        await virtual_time.advance(61)
        await worker.claim_tick()
        assert ticks()[-1].__dict__["state"] == "idle"
        await virtual_time.advance(61)
        watcher._snapshot.values["pipeline.worker_enabled"].bool_val = False
        await worker.claim_tick()
        assert ticks()[-1].__dict__["state"] == "disabled" and len(ticks()) == 3
    gate.set()


@pytest.mark.real_pg
async def test_db_duration_carries_only_step_phase_and_total_outcome(metric_reader, pipeline_pg):
    async def handler(job):
        async with job.db(5) as conn:
            await conn.fetchval("SELECT 1")
        return Succeeded()

    await insert_pipeline_job(pipeline_pg)
    worker = _worker(PipelineJobsRepository(pipeline_pg), pipeline_pg, _probe(handler))
    await worker.claim_tick()
    await _drain(worker)
    await worker.maintenance_tick()
    await worker.heartbeat_tick()
    points = _points(metric_reader, "analysis.pipeline.db.duration")
    steps = {dict(p.attributes)["step"] for p in points}
    assert {"claim", "report", "handler", "reap", "settle", "ensure", "stats"} <= steps
    for p in points:
        attrs = dict(p.attributes)
        assert set(attrs) <= {"step", "phase", "outcome"}, attrs
        assert ("outcome" in attrs) == (attrs["phase"] == "total"), attrs


def test_ac3_feature_337_new_instruments_carry_host_provider(otel_reset, monkeypatch):
    from opentelemetry.proto.collector.metrics.v1 import metrics_service_pb2

    from app.telemetry import init_telemetry

    monkeypatch.setenv("HOST_PROVIDER", "homelab")
    srv, seen = test_telemetry._start_body_receiver()
    try:
        test_telemetry._enable(monkeypatch, srv)
        init_telemetry()
        telemetry.record_pipeline_attempt("succeeded")
        telemetry.record_pipeline_lease_event("report_rejected")
        telemetry.record_pipeline_db_duration("claim", "total", 0.01, "ok")
        telemetry.register_pipeline_gauges()
        telemetry.set_pipeline_ready_stats({"watchlist": (2, 5.0)}, at=time.monotonic())
        test_telemetry._flush_all()
    finally:
        srv.shutdown()
        srv.server_close()
    found: dict[str, list] = {}
    for path, _auth, body in seen:
        if path != "/otlp/v1/metrics":
            continue
        req = metrics_service_pb2.ExportMetricsServiceRequest()
        req.ParseFromString(body)
        for rm in req.resource_metrics:
            for sm in rm.scope_metrics:
                for m in sm.metrics:
                    if m.name in _PIPELINE_INSTRUMENTS:
                        found.setdefault(m.name, []).extend(
                            m.sum.data_points or m.gauge.data_points or m.histogram.data_points
                        )
    assert set(found) == _PIPELINE_INSTRUMENTS
    for name, dps in found.items():
        assert dps, name
        for dp in dps:
            assert "host.provider" in {a.key for a in dp.attributes}, name
