"""Unit tests for the backfill webhook hand-off loop (feature 334).

No database and no gRPC: the job repository is replaced by an in-memory fake that applies the
same selection and marker guards as the SQL pinned in `test_backfill_jobs.py`, and notify is a
mock stub.
"""

import asyncio
import pathlib
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from gen.ingest.v1 import ingest_pb2
from gen.notify.v1 import notify_pb2
from google.protobuf.json_format import MessageToDict

from app.engine import webhook_handoff_loop as loop
from app.telemetry import LOOP_TICK_OK
from tests._helpers import job_row, rpc_error
from tests.conftest import _ctx, snapshot_watcher
from tests.test_ingest_servicer import (
    _chunk,
    _make_backfill_req,
    _mk_backfill_resp,
    make_servicer,
    patch_chunk_repo,
)

_REPO = "app.repositories.backfill_jobs"
_URL = "https://webhooks.ts.example.net:8443/hooks/h1"
_COMPLETED = ingest_pb2.BACKFILL_STATUS_COMPLETED
_FAILED = ingest_pb2.BACKFILL_STATUS_FAILED
_PARTIAL = ingest_pb2.BACKFILL_STATUS_PARTIAL
_CANCELED = ingest_pb2.BACKFILL_STATUS_CANCELED
_PAYLOAD_KEYS = {
    "job_id",
    "status",
    "data_kind",
    "symbols",
    "bars_processed",
    "failed_symbols",
    "started_at",
    "completed_at",
}
_T0 = datetime(2026, 11, 11, 12, 0, 0, tzinfo=UTC)
_T1 = datetime(2026, 11, 11, 12, 5, 0, tzinfo=UTC)


class _FakeJobs:
    """In-memory stand-in for the three hand-off repository functions."""

    def __init__(self, *rows):
        self.rows = {r["job_id"]: r for r in rows}
        self.calls: list[tuple] = []

    async def list_webhook_handoff_candidates(self, db_pool, *, terminal_statuses, limit):
        self.calls.append(("list", list(terminal_statuses), limit))
        hits = [
            r
            for r in self.rows.values()
            if r["callback_url"] is not None
            and r["status"] in terminal_statuses
            and r["webhook_enqueued_at"] is None
            and r["webhook_rejected_at"] is None
        ]
        return [dict(r) for r in hits[:limit]]

    async def _mark(self, column, job_id):
        self.calls.append((column, job_id))
        row = self.rows[job_id]
        if row["webhook_enqueued_at"] is not None or row["webhook_rejected_at"] is not None:
            return False
        row[column] = _T1
        return True

    async def mark_webhook_enqueued(self, db_pool, job_id):
        return await self._mark("webhook_enqueued_at", job_id)

    async def mark_webhook_rejected(self, db_pool, job_id):
        return await self._mark("webhook_rejected_at", job_id)

    def marks(self):
        return [c for c in self.calls if c[0] != "list"]


@pytest.fixture
def jobs(monkeypatch):
    def install(*rows):
        fake = _FakeJobs(*rows)
        for name in (
            "list_webhook_handoff_candidates",
            "mark_webhook_enqueued",
            "mark_webhook_rejected",
        ):
            monkeypatch.setattr(f"{_REPO}.{name}", getattr(fake, name))
        return fake

    return install


def _svc(fanout_side_effect=None):
    svc = MagicMock()
    svc._db = MagicMock()
    svc._webhook_wake = asyncio.Event()
    svc._notify = MagicMock()
    svc._notify.FanoutWebhook = AsyncMock(
        return_value=notify_pb2.FanoutWebhookResponse(), side_effect=fanout_side_effect
    )
    svc._notify.EmitAlert = AsyncMock()
    return svc


def _row(job_id, status, **over):
    over.setdefault("callback_url", _URL)
    over.setdefault("started_at", _T0)
    over.setdefault("completed_at", _T1)
    return job_row(job_id, status, **over)


def _sent(svc, index=0):
    return svc._notify.FanoutWebhook.await_args_list[index].args[0]


# ---------------------------------------------------------------------------
# AC-17 — each terminal status, driven through the servicer's own terminal write
# ---------------------------------------------------------------------------


async def _drive_to_terminal(status):
    """Run a real servicer path to `status`; return (servicer, the terminal update_job kwargs)."""
    svc = make_servicer(db=MagicMock(), retry=False)
    svc._notify = MagicMock()
    svc._notify.FanoutWebhook = AsyncMock(return_value=notify_pb2.FanoutWebhookResponse())
    svc._notify.EmitAlert = AsyncMock()
    svc._marketdata = MagicMock()
    if status == _CANCELED:
        running = job_row("job-1", ingest_pb2.BACKFILL_STATUS_RUNNING)
        with (
            patch(f"{_REPO}.get_job", AsyncMock(return_value=running)),
            patch(f"{_REPO}.update_job", AsyncMock()) as update_job,
        ):
            await svc.CancelBackfill(ingest_pb2.CancelBackfillRequest(job_id="job-1"), _ctx("4"))
        return svc, update_job.await_args_list[-1].kwargs
    svc._marketdata.BackfillBars = {
        _COMPLETED: AsyncMock(return_value=_mk_backfill_resp(100, [])),
        _PARTIAL: AsyncMock(return_value=_mk_backfill_resp(50, ["TSLA"])),
        _FAILED: AsyncMock(side_effect=Exception("network error")),
    }[status]
    with patch_chunk_repo([_chunk(["AAPL", "TSLA"])]) as m:
        await svc._run_backfill("job-1", _make_backfill_req(["AAPL", "TSLA"]))
    return svc, m["update_job"].await_args_list[-1].kwargs


@pytest.mark.parametrize(
    ("status", "status_name", "event_name"),
    [
        (_COMPLETED, "COMPLETED", "ingest.backfill.completed"),
        (_PARTIAL, "PARTIAL", "ingest.backfill.completed"),
        (_FAILED, "FAILED", "ingest.backfill.failed"),
        (_CANCELED, "CANCELED", "ingest.backfill.canceled"),
    ],
)
async def test_ac17_terminal_job_is_handed_off_once_notify_acknowledges(
    jobs, status, status_name, event_name
):
    svc, terminal = await _drive_to_terminal(status)
    assert terminal["status"] == status
    # The terminal write path only wakes the loop; it never calls FanoutWebhook itself.
    svc._notify.FanoutWebhook.assert_not_awaited()
    assert svc._webhook_wake.is_set()

    fake = jobs(_row("job-1", **{"started_at": _T0, **terminal}))
    order = []
    svc._notify.FanoutWebhook.side_effect = lambda *a, **k: (
        order.append(("fanout", list(fake.marks()))) or notify_pb2.FanoutWebhookResponse()
    )
    await loop.run_one_cycle(svc)

    svc._notify.FanoutWebhook.assert_awaited_once()
    sent = _sent(svc)
    assert sent.callback_url == _URL
    assert sent.event_name == event_name
    assert sent.idempotency_key == f"backfill:job-1:{status_name}"
    assert sent.validate_only is False
    payload = MessageToDict(sent.payload)
    assert payload["job_id"] == "job-1"
    assert payload["status"] == status_name
    # The marker is written only after notify acknowledged.
    assert order == [("fanout", [])]
    assert fake.marks() == [("webhook_enqueued_at", "job-1")]
    assert fake.rows["job-1"]["webhook_enqueued_at"] is not None
    assert fake.rows["job-1"]["webhook_rejected_at"] is None


async def test_handoff_call_carries_a_minted_trace_id_only_and_a_5s_timeout(jobs):
    jobs(_row("job-1", _COMPLETED), _row("job-2", _COMPLETED))
    svc = _svc()
    await loop.run_one_cycle(svc)
    calls = svc._notify.FanoutWebhook.await_args_list
    assert len(calls) == 2
    traces = []
    for call in calls:
        ((key, value),) = call.kwargs["metadata"]
        assert key == "x-trace-id"
        traces.append(value)
        assert call.kwargs["timeout"] == 5
    assert traces[0] != traces[1]


async def test_candidates_are_the_four_terminal_statuses_in_a_bounded_batch(jobs):
    """@AC-1 / @AC-21 / @AC-29: with no candidate there is no notify call at all."""
    fake = jobs(
        _row("no-callback", _COMPLETED, callback_url=None),
        _row("running", ingest_pb2.BACKFILL_STATUS_RUNNING),
        _row("queued", ingest_pb2.BACKFILL_STATUS_QUEUED),
        _row("enqueued", _COMPLETED, webhook_enqueued_at=_T1),
        _row("rejected", _FAILED, webhook_rejected_at=_T1),
    )
    svc = _svc()
    await loop.run_one_cycle(svc)
    svc._notify.FanoutWebhook.assert_not_awaited()
    svc._notify.EmitAlert.assert_not_awaited()
    (call,) = fake.calls
    assert call[0] == "list"
    assert sorted(call[1]) == sorted([_COMPLETED, _FAILED, _PARTIAL, _CANCELED])
    assert call[2] == 50


# ---------------------------------------------------------------------------
# AC-18 / AC-19 — notify unavailable, then recovered
# ---------------------------------------------------------------------------


async def test_ac18_notify_unavailable_sets_no_marker(jobs):
    fake = jobs(_row("job-1", _COMPLETED))
    svc = _svc(rpc_error(grpc.StatusCode.UNAVAILABLE, "down"))
    await loop.run_one_cycle(svc)
    assert fake.marks() == []
    assert fake.rows["job-1"]["status"] == _COMPLETED


async def test_ac19_retried_on_the_next_cycle_then_never_again(jobs):
    fake = jobs(_row("job-1", _PARTIAL))
    svc = _svc([rpc_error(grpc.StatusCode.UNAVAILABLE, "down"), notify_pb2.FanoutWebhookResponse()])
    await loop.run_one_cycle(svc)
    await loop.run_one_cycle(svc)
    await loop.run_one_cycle(svc)
    assert svc._notify.FanoutWebhook.await_count == 2
    assert (
        _sent(svc, 0).idempotency_key == _sent(svc, 1).idempotency_key == "backfill:job-1:PARTIAL"
    )
    assert fake.marks() == [("webhook_enqueued_at", "job-1")]


# ---------------------------------------------------------------------------
# AC-20 — notify refuses the URL at job end
# ---------------------------------------------------------------------------


async def test_ac20_rejected_url_is_marked_then_alerted_once(jobs):
    fake = jobs(_row("job-1", _COMPLETED))
    svc = _svc(rpc_error(grpc.StatusCode.INVALID_ARGUMENT, "callback_url rejected: scheme"))
    marks_at_alert = []
    svc._notify.EmitAlert.side_effect = lambda *a, **k: marks_at_alert.append(list(fake.marks()))

    await loop.run_one_cycle(svc)
    await loop.run_one_cycle(svc)

    assert svc._notify.FanoutWebhook.await_count == 1
    assert fake.marks() == [("webhook_rejected_at", "job-1")]
    assert fake.rows["job-1"]["webhook_rejected_at"] is not None
    assert fake.rows["job-1"]["webhook_enqueued_at"] is None
    # The marker is written before the alert is attempted.
    assert marks_at_alert == [[("webhook_rejected_at", "job-1")]]
    svc._notify.EmitAlert.assert_awaited_once()
    alert = svc._notify.EmitAlert.await_args.args[0]
    assert alert.severity == notify_pb2.ALERT_SEVERITY_WARNING
    assert alert.category == "backfill"
    assert alert.source_service == "xstockstrat-ingest"
    assert "job-1" in alert.title
    assert "callback_url rejected: scheme" in alert.body
    assert list(alert.tags) == ["job_id:job-1"]
    assert "webhooks.ts.example.net" not in alert.SerializeToString().decode("utf-8", "ignore")
    ((key, _),) = svc._notify.EmitAlert.await_args.kwargs["metadata"]
    assert key == "x-trace-id"


async def test_ac20_failing_alert_does_not_fail_the_cycle_or_stop_later_jobs(jobs):
    fake = jobs(_row("job-1", _COMPLETED), _row("job-2", _COMPLETED))
    svc = _svc(
        [
            rpc_error(grpc.StatusCode.INVALID_ARGUMENT, "callback_url rejected: scheme"),
            notify_pb2.FanoutWebhookResponse(),
        ]
    )
    svc._notify.EmitAlert.side_effect = Exception("alert store down")
    await loop.run_one_cycle(svc)
    assert fake.marks() == [("webhook_rejected_at", "job-1"), ("webhook_enqueued_at", "job-2")]


async def test_no_alert_when_the_rejected_marker_changed_no_row(jobs, monkeypatch):
    jobs(_row("job-1", _COMPLETED))
    monkeypatch.setattr(f"{_REPO}.mark_webhook_rejected", AsyncMock(return_value=False))
    svc = _svc(rpc_error(grpc.StatusCode.INVALID_ARGUMENT, "callback_url rejected: scheme"))
    await loop.run_one_cycle(svc)
    svc._notify.EmitAlert.assert_not_awaited()


# ---------------------------------------------------------------------------
# AC-29 / AC-30 — once per job; payload from row columns only
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("marker", ["webhook_enqueued_at", "webhook_rejected_at"])
async def test_ac29_a_marked_job_is_never_handed_off_again_under_another_status(jobs, marker):
    first = (
        rpc_error(grpc.StatusCode.INVALID_ARGUMENT, "callback_url rejected: scheme")
        if marker == "webhook_rejected_at"
        else notify_pb2.FanoutWebhookResponse()
    )
    fake = jobs(_row("job-1", _FAILED, error="interrupted by restart"))
    svc = _svc([first])
    await loop.run_one_cycle(svc)
    assert fake.rows["job-1"][marker] is not None

    # A restart re-drives the job to a different terminal status.
    fake.rows["job-1"]["status"] = _COMPLETED
    await loop.run_one_cycle(svc)
    assert svc._notify.FanoutWebhook.await_count == 1
    assert _sent(svc).idempotency_key == "backfill:job-1:FAILED"


async def test_ac30_payload_has_exactly_the_eight_row_keys_and_no_error(jobs):
    internal = "internal: peer ipv4:10.0.0.7:50053"
    jobs(
        _row(
            "job-7",
            _FAILED,
            error=internal,
            symbols=["AAPL", "TSLA"],
            failed_symbols=["TSLA"],
            bars_processed=42,
            data_kind="FUNDAMENTALS",
        )
    )
    svc = _svc()
    await loop.run_one_cycle(svc)
    sent = _sent(svc)
    payload = MessageToDict(sent.payload)
    assert set(payload) == _PAYLOAD_KEYS
    assert payload == {
        "job_id": "job-7",
        "status": "FAILED",
        "data_kind": "FUNDAMENTALS",
        "symbols": ["AAPL", "TSLA"],
        "bars_processed": 42,
        "failed_symbols": ["TSLA"],
        "started_at": "2026-11-11T12:00:00+00:00",
        "completed_at": "2026-11-11T12:05:00+00:00",
    }
    wire = sent.SerializeToString().decode("utf-8", "ignore")
    assert "10.0.0.7" not in wire
    assert "internal" not in wire


async def test_payload_timestamps_are_null_when_the_row_has_none(jobs):
    jobs(_row("job-1", _CANCELED, started_at=None, completed_at=None))
    svc = _svc()
    await loop.run_one_cycle(svc)
    payload = MessageToDict(_sent(svc).payload)
    assert set(payload) == _PAYLOAD_KEYS
    assert payload["started_at"] is None
    assert payload["completed_at"] is None


# ---------------------------------------------------------------------------
# Cycle end on any other failure; guards; tick log
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("failure", "level"),
    [
        (rpc_error(grpc.StatusCode.PERMISSION_DENIED, "peer not authorized"), "ERROR"),
        (rpc_error(grpc.StatusCode.UNAVAILABLE, "down"), "WARNING"),
        (rpc_error(grpc.StatusCode.DEADLINE_EXCEEDED, "slow"), "WARNING"),
        (rpc_error(grpc.StatusCode.INTERNAL, "webhook delivery could not be stored"), "WARNING"),
        (RuntimeError("channel closed"), "WARNING"),
    ],
    ids=["permission-denied", "unavailable", "deadline", "internal", "non-grpc"],
)
async def test_any_other_failure_ends_the_cycle_and_leaves_later_jobs_untouched(
    jobs, caplog, failure, level
):
    fake = jobs(_row("job-1", _COMPLETED), _row("job-2", _COMPLETED))
    svc = _svc(failure)
    with caplog.at_level("DEBUG", logger=loop.log.name):
        await loop.run_one_cycle(svc)
    assert svc._notify.FanoutWebhook.await_count == 1
    assert fake.marks() == []
    records = [r for r in caplog.records if r.levelname in ("WARNING", "ERROR")]
    assert [r.levelname for r in records] == [level]
    assert "job-1" in records[0].getMessage()
    assert LOOP_TICK_OK not in caplog.text
    assert "webhooks.ts.example.net" not in caplog.text


async def test_cycle_is_a_no_op_without_a_database_or_a_notify_stub(jobs):
    fake = jobs(_row("job-1", _COMPLETED))
    svc = _svc()
    svc._db = None
    await loop.run_one_cycle(svc)
    svc._db, notify, svc._notify = MagicMock(), svc._notify, None
    await loop.run_one_cycle(svc)
    assert fake.calls == []
    notify.FanoutWebhook.assert_not_awaited()


@pytest.mark.parametrize(("rows", "state"), [((), "idle"), ((_row("job-1", _COMPLETED),), None)])
async def test_a_finished_cycle_logs_one_tick(jobs, caplog, rows, state):
    jobs(*rows)
    with caplog.at_level("INFO", logger=loop.log.name):
        await loop.run_one_cycle(_svc())
    (tick,) = [r for r in caplog.records if r.getMessage() == LOOP_TICK_OK]
    assert tick.loop == "webhook_handoff"
    assert getattr(tick, "state", None) == state


# ---------------------------------------------------------------------------
# The loop: wait first, interval from config, wake-up
# ---------------------------------------------------------------------------


class _StopLoop(BaseException):
    """Not an Exception: the loop swallows every Exception a cycle raises."""


def _timing_out_wait(seen):
    """Stand-in for asyncio.wait_for that records the timeout and reports it as elapsed."""

    async def fake_wait_for(awaitable, timeout):
        awaitable.close()
        seen.append(("wait", timeout))
        raise TimeoutError

    return fake_wait_for


async def _run_until_first_cycle(monkeypatch, svc, cfg):
    seen = []

    async def cycle(servicer):
        seen.append(("cycle", servicer._webhook_wake.is_set()))
        raise _StopLoop

    monkeypatch.setattr(loop.asyncio, "wait_for", _timing_out_wait(seen))
    monkeypatch.setattr(loop, "run_one_cycle", cycle)
    with pytest.raises(_StopLoop):
        await loop.run_webhook_handoff_loop(svc, cfg)
    return seen


@pytest.mark.parametrize(("stored", "expected"), [(0, 60), (-3, 60), (45, 45), (None, 60)])
async def test_loop_waits_the_configured_interval_before_its_first_cycle(
    monkeypatch, stored, expected
):
    """O-17 wait-first; a stored <= 0 interval reads as 60, a stored value is honoured."""
    values = {} if stored is None else {"backfill.webhook_sweep_interval_seconds": stored}
    seen = await _run_until_first_cycle(monkeypatch, _svc(), snapshot_watcher(**values))
    assert seen == [("wait", expected), ("cycle", False)]


async def test_interval_is_re_read_on_every_iteration(monkeypatch):
    seen = []
    cfg = MagicMock()
    intervals = iter([60, 15])
    type(cfg).backfill_webhook_sweep_interval_seconds = property(lambda self: next(intervals))

    async def cycle(servicer):
        if len(seen) == 2:
            raise _StopLoop

    monkeypatch.setattr(loop.asyncio, "wait_for", _timing_out_wait(seen))
    monkeypatch.setattr(loop, "run_one_cycle", cycle)
    with pytest.raises(_StopLoop):
        await loop.run_webhook_handoff_loop(_svc(), cfg)
    assert seen == [("wait", 60), ("wait", 15)]


async def test_a_failing_cycle_is_logged_and_the_loop_continues(monkeypatch, caplog):
    seen = []
    cycles = []

    async def cycle(servicer):
        cycles.append(1)
        if len(cycles) == 1:
            raise RuntimeError("db down")
        raise _StopLoop

    monkeypatch.setattr(loop.asyncio, "wait_for", _timing_out_wait(seen))
    monkeypatch.setattr(loop, "run_one_cycle", cycle)
    with caplog.at_level("WARNING", logger=loop.log.name), pytest.raises(_StopLoop):
        await loop.run_webhook_handoff_loop(_svc(), snapshot_watcher())
    assert len(cycles) == 2
    assert "db down" in caplog.text


async def test_wake_up_runs_a_cycle_before_the_interval_elapses(monkeypatch):
    svc = _svc()
    ran = asyncio.Event()
    wake_state = []

    async def cycle(servicer):
        wake_state.append(servicer._webhook_wake.is_set())
        ran.set()

    monkeypatch.setattr(loop, "run_one_cycle", cycle)
    cfg = snapshot_watcher(**{"backfill.webhook_sweep_interval_seconds": 3600})
    task = asyncio.create_task(loop.run_webhook_handoff_loop(svc, cfg))
    try:
        for _ in range(5):
            await asyncio.sleep(0)
        assert not ran.is_set()  # nothing runs at start: the loop waits first
        svc._webhook_wake.set()
        await asyncio.wait_for(ran.wait(), timeout=2)
        assert wake_state == [False]  # cleared before the cycle, so a set during it is kept
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_ac25_reconciled_job_is_handed_off_by_the_interval_tick(jobs, monkeypatch):
    """T6 writes FAILED at boot with no servicer and no wake-up; the interval tick covers it."""
    fake = jobs(_row("job-6", _FAILED, error="interrupted by restart"))
    svc = _svc()
    real_cycle = loop.run_one_cycle

    async def cycle(servicer):
        await real_cycle(servicer)
        raise _StopLoop

    monkeypatch.setattr(loop.asyncio, "wait_for", _timing_out_wait([]))
    monkeypatch.setattr(loop, "run_one_cycle", cycle)
    assert not svc._webhook_wake.is_set()
    with pytest.raises(_StopLoop):
        await loop.run_webhook_handoff_loop(svc, snapshot_watcher())

    sent = _sent(svc)
    assert sent.event_name == "ingest.backfill.failed"
    assert sent.idempotency_key == "backfill:job-6:FAILED"
    assert "interrupted" not in sent.SerializeToString().decode("utf-8", "ignore")
    assert fake.marks() == [("webhook_enqueued_at", "job-6")]


def test_main_starts_the_loop_after_resume_incomplete_jobs():
    """O-17: resumed jobs are flipped back to RUNNING before the first hand-off cycle can run."""
    src = (pathlib.Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()
    resume = src.index("servicer.resume_incomplete_jobs()")
    start = src.index("run_webhook_handoff_loop(servicer, cfg_watcher)")
    assert resume < start
