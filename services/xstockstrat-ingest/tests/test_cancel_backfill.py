"""Unit tests for ingest CancelBackfill + ListBackfillJobs/list_jobs symbol filter (feature 057).

The asyncpg pool, gRPC context, and repo functions are mocked, so these exercise the cancel
state machine, the admin gate, and the symbol-filter SQL without a DB or gRPC server.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from gen.ingest.v1 import ingest_pb2

from app.handlers.servicer import IngestServicer
from app.repositories import backfill_jobs

_REPO = "app.repositories.backfill_jobs"


def _make_servicer(db=None) -> IngestServicer:
    cfg = MagicMock()
    cfg.backfill_max_concurrent_jobs = 5
    cfg.backfill_retry_on_failure = True
    cfg.backfill_max_retry_attempts = 3
    cfg.backfill_max_concurrent_chunks = 5
    cfg.backfill_chunk_window_days = 400
    cfg.backfill_chunk_max_bars = 10_000_000
    svc = IngestServicer(cfg, MagicMock(), MagicMock(), db_pool=db)
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    return svc


def _job_row(job_id: str, status: int, **over) -> dict:
    row = {
        "job_id": job_id,
        "symbols": ["AAPL"],
        "timeframe": "1d",
        "range_start": None,
        "range_end": None,
        "status": status,
        "bars_processed": 0,
        "bars_total": 0,
        "chunks_total": 0,
        "chunks_completed": 0,
        "failed_symbols": [],
        "error": "",
        "started_at": None,
        "completed_at": None,
        "created_at": None,
    }
    row.update(over)
    return row


def _ctx(access_scope: str = "4"):
    """A fake gRPC context: invocation_metadata carries the access scope; abort raises."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(
        return_value=[
            ("x-access-scope", access_scope),
            ("x-user-id", "u1"),
            ("x-trace-id", "t1"),
        ]
    )
    ctx.abort = AsyncMock(side_effect=Exception("aborted"))
    return ctx


# ── CancelBackfill ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cancel_running_job_transitions_to_canceled():
    svc = _make_servicer(db=MagicMock())
    running = _job_row("j1", ingest_pb2.BACKFILL_STATUS_RUNNING)
    canceled = _job_row("j1", ingest_pb2.BACKFILL_STATUS_CANCELED)
    with (
        patch(f"{_REPO}.get_job", AsyncMock(side_effect=[running, canceled])),
        patch(f"{_REPO}.update_job", AsyncMock()) as upd,
    ):
        result = await svc.CancelBackfill(ingest_pb2.CancelBackfillRequest(job_id="j1"), _ctx("4"))
    assert result.status == ingest_pb2.BACKFILL_STATUS_CANCELED
    assert "j1" in svc._canceled_jobs  # registered so the runner stops scheduling chunks
    assert upd.await_args.kwargs["status"] == ingest_pb2.BACKFILL_STATUS_CANCELED


@pytest.mark.asyncio
async def test_cancel_without_admin_scope_aborts_permission_denied():
    svc = _make_servicer(db=MagicMock())
    ctx = _ctx("0")  # no ADMIN bit
    with pytest.raises(Exception, match="aborted"):
        await svc.CancelBackfill(ingest_pb2.CancelBackfillRequest(job_id="j1"), ctx)
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.PERMISSION_DENIED


@pytest.mark.asyncio
async def test_cancel_terminal_job_aborts_failed_precondition():
    svc = _make_servicer(db=MagicMock())
    completed = _job_row("j1", ingest_pb2.BACKFILL_STATUS_COMPLETED)
    ctx = _ctx("4")
    with patch(f"{_REPO}.get_job", AsyncMock(return_value=completed)):
        with pytest.raises(Exception, match="aborted"):
            await svc.CancelBackfill(ingest_pb2.CancelBackfillRequest(job_id="j1"), ctx)
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.FAILED_PRECONDITION


@pytest.mark.asyncio
async def test_cancel_unknown_job_aborts_not_found():
    svc = _make_servicer(db=MagicMock())
    ctx = _ctx("4")
    with patch(f"{_REPO}.get_job", AsyncMock(return_value=None)):
        with pytest.raises(Exception, match="aborted"):
            await svc.CancelBackfill(ingest_pb2.CancelBackfillRequest(job_id="missing"), ctx)
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.NOT_FOUND


@pytest.mark.asyncio
async def test_cancel_aborts_when_no_db():
    svc = _make_servicer(db=None)
    ctx = _ctx("4")
    with pytest.raises(Exception, match="aborted"):
        await svc.CancelBackfill(ingest_pb2.CancelBackfillRequest(job_id="j1"), ctx)
    assert ctx.abort.await_args.args[0] == grpc.StatusCode.UNAVAILABLE


# ── ListBackfillJobs / list_jobs symbol filter ──────────────────────────────


@pytest.mark.asyncio
async def test_list_jobs_symbol_filter_builds_any_predicate():
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    await backfill_jobs.list_jobs(pool, symbol_filter="AAPL", limit=10, offset=0)
    sql = pool.fetch.await_args.args[0]
    assert "$1 = ANY(symbols)" in sql
    assert "AAPL" in pool.fetch.await_args.args


@pytest.mark.asyncio
async def test_list_jobs_status_and_symbol_filters_combine():
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    await backfill_jobs.list_jobs(pool, status_filter=2, symbol_filter="TSLA", limit=5, offset=0)
    sql = pool.fetch.await_args.args[0]
    assert "status = $1" in sql
    assert "$2 = ANY(symbols)" in sql
    assert " AND " in sql


@pytest.mark.asyncio
async def test_list_jobs_no_filters_omits_where():
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    await backfill_jobs.list_jobs(pool, limit=5, offset=0)
    sql = pool.fetch.await_args.args[0]
    assert "WHERE" not in sql


@pytest.mark.asyncio
async def test_list_backfill_jobs_forwards_symbol_filter():
    svc = _make_servicer(db=MagicMock())
    with patch(f"{_REPO}.list_jobs", AsyncMock(return_value=[])) as m:
        req = ingest_pb2.ListBackfillJobsRequest(symbol="NVDA")
        await svc.ListBackfillJobs(req, context=MagicMock())
    assert m.await_args.kwargs["symbol_filter"] == "NVDA"
