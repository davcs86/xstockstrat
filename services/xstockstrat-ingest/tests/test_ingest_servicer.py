"""
Unit tests for IngestServicer — no gRPC connections required.

The servicer is instantiated with MagicMock channels; internal state
(_jobs, _db) is manipulated directly to exercise business logic without
a running gRPC server or database.
"""

import asyncio
import json
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: F401 (imported via conftest path)
from gen.notify.v1 import notify_pb2
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import IngestServicer


def make_servicer(
    db=None,
    *,
    max_concurrent: int = 5,
    retry: bool = True,
    max_retry: int = 3,
    max_concurrent_chunks: int = 5,
    chunk_window_days: int = 400,
    chunk_max_bars: int = 10_000_000,
) -> IngestServicer:
    """Return an IngestServicer with fully mocked dependencies.

    The config getters are real ints/bools (not MagicMocks) because __init__ builds an
    asyncio.Semaphore from them and the chunk planner does arithmetic on them. The default
    400-day window + huge bar cap make a 1-symbol / default-range job plan exactly one chunk,
    so the per-job lifecycle/retry/partial behavior is exercised through the chunked path.
    """
    cfg = MagicMock()
    cfg.backfill_max_concurrent_jobs = max_concurrent
    cfg.backfill_retry_on_failure = retry
    cfg.backfill_max_retry_attempts = max_retry
    cfg.backfill_max_concurrent_chunks = max_concurrent_chunks
    cfg.backfill_chunk_window_days = chunk_window_days
    cfg.backfill_chunk_max_bars = chunk_max_bars
    marketdata_ch = MagicMock()
    ledger_ch = MagicMock()
    svc = IngestServicer(cfg, marketdata_ch, ledger_ch, db_pool=db)
    # Default ledger/notify to swallowing async mocks; individual tests override.
    svc._ledger = MagicMock()
    svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    return svc


# ---------------------------------------------------------------------------
# Durable backfill jobs (feature 052) — servicer reads/writes the repo, not _jobs
# ---------------------------------------------------------------------------

_REPO = "app.repositories.backfill_jobs"


def _job_row(job_id: str, status: int, **over) -> dict:
    """A backfill_jobs row dict as asyncpg would return it."""
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


def _mk_backfill_resp(bars_written: int, failed_symbols: list[str], expected_bars: int = 0):
    resp = MagicMock()
    resp.bars_written = bars_written
    resp.failed_symbols = failed_symbols
    resp.expected_bars = expected_bars
    return resp


class TestListBackfillJobs:
    @pytest.mark.asyncio
    async def test_returns_all_jobs_when_no_filter(self):
        svc = make_servicer(db=MagicMock())
        rows = [
            _job_row("j1", ingest_pb2.BACKFILL_STATUS_QUEUED),
            _job_row("j2", ingest_pb2.BACKFILL_STATUS_COMPLETED),
        ]
        with patch(f"{_REPO}.list_jobs", AsyncMock(return_value=rows)) as m:
            req = ingest_pb2.ListBackfillJobsRequest(
                status_filter=ingest_pb2.BACKFILL_STATUS_UNSPECIFIED
            )
            resp = await svc.ListBackfillJobs(req, context=MagicMock())
        assert len(resp.jobs) == 2
        # UNSPECIFIED filter → status_filter=None passed to the repo
        assert m.call_args.kwargs["status_filter"] is None

    @pytest.mark.asyncio
    async def test_filters_by_status(self):
        svc = make_servicer(db=MagicMock())
        rows = [_job_row("j2", ingest_pb2.BACKFILL_STATUS_COMPLETED)]
        with patch(f"{_REPO}.list_jobs", AsyncMock(return_value=rows)) as m:
            req = ingest_pb2.ListBackfillJobsRequest(
                status_filter=ingest_pb2.BACKFILL_STATUS_COMPLETED
            )
            resp = await svc.ListBackfillJobs(req, context=MagicMock())
        assert len(resp.jobs) == 1
        assert m.call_args.kwargs["status_filter"] == ingest_pb2.BACKFILL_STATUS_COMPLETED

    @pytest.mark.asyncio
    async def test_aborts_when_no_db(self):
        svc = make_servicer(db=None)
        req = ingest_pb2.ListBackfillJobsRequest()
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.ListBackfillJobs(req, context)


class TestGetBackfillStatus:
    @pytest.mark.asyncio
    async def test_returns_job_when_found(self):
        svc = make_servicer(db=MagicMock())
        row = _job_row("job-abc", ingest_pb2.BACKFILL_STATUS_RUNNING, symbols=["TSLA"])
        with patch(f"{_REPO}.get_job", AsyncMock(return_value=row)):
            req = ingest_pb2.GetBackfillStatusRequest(job_id="job-abc")
            result = await svc.GetBackfillStatus(req, context=MagicMock())
        assert result.job_id == "job-abc"
        assert result.status == ingest_pb2.BACKFILL_STATUS_RUNNING

    @pytest.mark.asyncio
    async def test_aborts_when_not_found(self):
        svc = make_servicer(db=MagicMock())
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))
        with patch(f"{_REPO}.get_job", AsyncMock(return_value=None)):
            with pytest.raises(Exception, match="aborted"):
                await svc.GetBackfillStatus(
                    ingest_pb2.GetBackfillStatusRequest(job_id="missing"), context
                )
        context.abort.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_aborts_when_no_db(self):
        svc = make_servicer(db=None)
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.GetBackfillStatus(ingest_pb2.GetBackfillStatusRequest(job_id="x"), context)


# ---------------------------------------------------------------------------
# NormalizeRawData — private helpers via the RPC method
# ---------------------------------------------------------------------------


class TestNormalizeRawData:
    @pytest.mark.asyncio
    async def test_csv_counts_rows(self):
        csv_data = "symbol,price\nAAPL,150\nTSLA,200\nGOOGL,100\n"
        req = MagicMock()
        req.format = "csv"
        req.raw_data = csv_data.encode()

        svc = make_servicer()
        resp = await svc.NormalizeRawData(req, context=MagicMock())
        assert resp.rows_normalized == 3
        assert resp.errors == []

    @pytest.mark.asyncio
    async def test_json_list_counts_items(self):
        data = [{"symbol": "AAPL", "price": 150}, {"symbol": "TSLA", "price": 200}]
        req = MagicMock()
        req.format = "json"
        req.raw_data = json.dumps(data).encode()

        svc = make_servicer()
        resp = await svc.NormalizeRawData(req, context=MagicMock())
        assert resp.rows_normalized == 2
        assert resp.errors == []

    @pytest.mark.asyncio
    async def test_json_object_counts_as_one(self):
        req = MagicMock()
        req.format = "json"
        req.raw_data = json.dumps({"symbol": "AAPL"}).encode()

        svc = make_servicer()
        resp = await svc.NormalizeRawData(req, context=MagicMock())
        assert resp.rows_normalized == 1

    @pytest.mark.asyncio
    async def test_unknown_format_returns_error(self):
        req = MagicMock()
        req.format = "parquet"
        req.raw_data = b"dummy"

        svc = make_servicer()
        resp = await svc.NormalizeRawData(req, context=MagicMock())
        assert resp.rows_normalized == 0
        assert len(resp.errors) == 1
        assert "Unknown format" in resp.errors[0]

    @pytest.mark.asyncio
    async def test_alpaca_v2_format(self):
        data = [{"t": "2024-01-01", "o": 100}, {"t": "2024-01-02", "o": 101}]
        req = MagicMock()
        req.format = "alpaca_v2"
        req.raw_data = json.dumps(data).encode()

        svc = make_servicer()
        resp = await svc.NormalizeRawData(req, context=MagicMock())
        assert resp.rows_normalized == 2

    @pytest.mark.asyncio
    async def test_invalid_json_returns_error(self):
        req = MagicMock()
        req.format = "json"
        req.raw_data = b"not-valid-json!!!"

        svc = make_servicer()
        resp = await svc.NormalizeRawData(req, context=MagicMock())
        assert resp.rows_normalized == 0
        assert len(resp.errors) == 1


# ---------------------------------------------------------------------------
# TriggerBackfill
# ---------------------------------------------------------------------------


class TestTriggerBackfill:
    @pytest.mark.asyncio
    async def test_inserts_queued_row_and_emits_queued_event(self):
        svc = make_servicer(db=MagicMock())
        req = MagicMock()
        req.symbols = ["AAPL", "TSLA"]
        req.timeframe = "1d"
        req.range = common_pb2.TimeRange()

        with (
            patch("asyncio.create_task"),
            patch(f"{_REPO}.insert_job", AsyncMock()) as insert,
        ):
            resp = await svc.TriggerBackfill(req, context=MagicMock())

        assert resp.status == ingest_pb2.BACKFILL_STATUS_QUEUED
        assert resp.job_id != ""
        # A QUEUED row was inserted...
        insert.assert_awaited_once()
        assert insert.await_args.kwargs["status"] == ingest_pb2.BACKFILL_STATUS_QUEUED
        # ...and the queued lifecycle event was emitted.
        event_types = [c.args[0].event_type for c in svc._ledger.AppendEvent.call_args_list]
        assert "ingest.backfill.queued" in event_types

    @pytest.mark.asyncio
    async def test_aborts_when_no_db(self):
        svc = make_servicer(db=None)
        req = MagicMock()
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))
        with pytest.raises(Exception, match="aborted"):
            await svc.TriggerBackfill(req, context)


# ---------------------------------------------------------------------------
# _run_backfill — durable lifecycle, alert, retry, concurrency (Steps 6-7)
# ---------------------------------------------------------------------------


_CHUNKS = "app.repositories.backfill_chunks"


def _make_backfill_req(symbols, timeframe="1d"):
    req = MagicMock()
    req.symbols = symbols
    req.timeframe = timeframe
    req.timeframe_enum = 0
    req.overwrite = False
    req.fill_mode = ingest_pb2.FILL_MODE_FULL
    req.range = common_pb2.TimeRange()
    return req


def _chunk(symbols, cid="chunk-1"):
    return {
        "chunk_id": cid,
        "symbols": symbols,
        "range_start": datetime(2024, 1, 1, tzinfo=UTC),
        "range_end": datetime(2024, 2, 1, tzinfo=UTC),
    }


@contextmanager
def patch_chunk_repo(incomplete):
    """Patch the backfill_chunks + backfill_jobs writes so the chunked path runs against mocks.

    ``get_incomplete_chunks`` returns ``incomplete`` (the chunks _run_chunks iterates). Yields
    a dict of the key AsyncMocks for assertions.
    """
    with ExitStack() as st:
        ids = [c["chunk_id"] for c in incomplete]
        st.enter_context(patch(f"{_CHUNKS}.insert_chunks", AsyncMock(return_value=ids)))
        st.enter_context(
            patch(f"{_CHUNKS}.get_incomplete_chunks", AsyncMock(return_value=incomplete))
        )
        st.enter_context(patch(f"{_CHUNKS}.mark_chunk_running", AsyncMock()))
        mc = st.enter_context(patch(f"{_CHUNKS}.mark_chunk_completed", AsyncMock()))
        mf = st.enter_context(patch(f"{_CHUNKS}.mark_chunk_failed", AsyncMock()))
        uj = st.enter_context(patch(f"{_REPO}.update_job", AsyncMock()))
        yield {"mark_completed": mc, "mark_failed": mf, "update_job": uj}


class TestRunBackfill:
    @pytest.mark.asyncio
    async def test_success_emits_running_then_completed(self):
        svc = make_servicer(db=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(return_value=_mk_backfill_resp(100, []))
        with patch_chunk_repo([_chunk(["AAPL"])]) as m:
            await svc._run_backfill("job-1", _make_backfill_req(["AAPL"]))

        events = [c.args[0].event_type for c in svc._ledger.AppendEvent.call_args_list]
        assert events == ["ingest.backfill.running", "ingest.backfill.completed"]
        m["mark_completed"].assert_awaited_once()
        final = m["update_job"].await_args_list[-1].kwargs
        assert final["status"] == ingest_pb2.BACKFILL_STATUS_COMPLETED
        assert final["bars_processed"] == 100

    @pytest.mark.asyncio
    async def test_partial_emits_completed_and_warning_alert(self):
        # A chunk that returns failed_symbols (retry off) → job PARTIAL, completed event, WARNING.
        svc = make_servicer(db=MagicMock(), retry=False)
        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(return_value=_mk_backfill_resp(50, ["TSLA"]))
        svc._notify = MagicMock()
        svc._notify.EmitAlert = AsyncMock(return_value=MagicMock())

        with patch_chunk_repo([_chunk(["AAPL", "TSLA"])]) as m:
            await svc._run_backfill("job-2", _make_backfill_req(["AAPL", "TSLA"]))

        events = [c.args[0].event_type for c in svc._ledger.AppendEvent.call_args_list]
        assert "ingest.backfill.completed" in events
        assert "ingest.backfill.failed" not in events
        assert (
            m["update_job"].await_args_list[-1].kwargs["status"]
            == ingest_pb2.BACKFILL_STATUS_PARTIAL
        )
        svc._notify.EmitAlert.assert_awaited_once()
        assert (
            svc._notify.EmitAlert.await_args.args[0].severity == notify_pb2.ALERT_SEVERITY_WARNING
        )

    @pytest.mark.asyncio
    async def test_all_chunks_fail_emits_failed_and_error_alert(self):
        svc = make_servicer(db=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(side_effect=Exception("network error"))
        svc._notify = MagicMock()
        svc._notify.EmitAlert = AsyncMock(return_value=MagicMock())

        with patch_chunk_repo([_chunk(["AAPL"])]) as m:
            await svc._run_backfill("job-3", _make_backfill_req(["AAPL"]))

        events = [c.args[0].event_type for c in svc._ledger.AppendEvent.call_args_list]
        assert "ingest.backfill.failed" in events
        assert (
            m["update_job"].await_args_list[-1].kwargs["status"]
            == ingest_pb2.BACKFILL_STATUS_FAILED
        )
        m["mark_failed"].assert_awaited_once()
        assert svc._notify.EmitAlert.await_args.args[0].severity == notify_pb2.ALERT_SEVERITY_ERROR

    @pytest.mark.asyncio
    async def test_retry_on_failure_retries_failed_symbols(self):
        svc = make_servicer(db=MagicMock(), retry=True, max_retry=2)
        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(return_value=_mk_backfill_resp(10, ["TSLA"]))
        with patch_chunk_repo([_chunk(["TSLA"])]), patch("asyncio.sleep", AsyncMock()):
            await svc._run_backfill("job-4", _make_backfill_req(["TSLA"]))
        # initial attempt + 2 retries, per chunk
        assert svc._marketdata.BackfillBars.await_count == 3

    @pytest.mark.asyncio
    async def test_no_retry_when_disabled(self):
        svc = make_servicer(db=MagicMock(), retry=False)
        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(return_value=_mk_backfill_resp(10, ["TSLA"]))
        with patch_chunk_repo([_chunk(["TSLA"])]), patch("asyncio.sleep", AsyncMock()):
            await svc._run_backfill("job-5", _make_backfill_req(["TSLA"]))
        assert svc._marketdata.BackfillBars.await_count == 1

    @pytest.mark.asyncio
    async def test_job_concurrency_gate_serializes_jobs(self):
        svc = make_servicer(db=MagicMock(), max_concurrent=1)
        in_flight = 0
        peak = 0

        async def _backfill(_req, metadata=None):
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.01)
            in_flight -= 1
            return _mk_backfill_resp(10, [])

        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = _backfill

        with patch_chunk_repo([_chunk(["AAPL"])]):
            await asyncio.gather(
                svc._run_backfill("c1", _make_backfill_req(["AAPL"])),
                svc._run_backfill("c2", _make_backfill_req(["TSLA"])),
            )
        assert peak == 1  # max_concurrent_jobs=1 serializes the two jobs

    @pytest.mark.asyncio
    async def test_chunk_concurrency_gate_limits_parallel_chunks(self):
        # Two chunks, max_concurrent_chunks=1 → chunk semaphore serializes them.
        svc = make_servicer(db=MagicMock(), max_concurrent_chunks=1)
        in_flight = 0
        peak = 0

        async def _backfill(_req, metadata=None):
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.01)
            in_flight -= 1
            return _mk_backfill_resp(10, [])

        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = _backfill
        with patch_chunk_repo([_chunk(["AAPL"], "c1"), _chunk(["TSLA"], "c2")]):
            await svc._run_backfill("job-6", _make_backfill_req(["AAPL", "TSLA"]))
        assert peak == 1

    @pytest.mark.asyncio
    async def test_gaps_only_plans_from_coverage_gaps(self):
        # FILL_MODE_GAPS_ONLY → GetDataCoverage drives planning; a gap range is fetched.
        svc = make_servicer(db=MagicMock())
        gap = common_pb2.TimeRange(
            start=Timestamp(seconds=1_700_000_000), end=Timestamp(seconds=1_701_000_000)
        )
        cov = MagicMock()
        cov.gaps = [gap]
        svc._marketdata = MagicMock()
        svc._marketdata.GetDataCoverage = AsyncMock(return_value=cov)
        svc._marketdata.BackfillBars = AsyncMock(return_value=_mk_backfill_resp(5, []))

        req = _make_backfill_req(["AAPL"])
        req.fill_mode = ingest_pb2.FILL_MODE_GAPS_ONLY
        # Real plan_chunks/insert/get must run for GAPS_ONLY; only patch the writes + reads.
        with (
            patch(f"{_CHUNKS}.insert_chunks", AsyncMock(return_value=["g1"])),
            patch(
                f"{_CHUNKS}.get_incomplete_chunks", AsyncMock(return_value=[_chunk(["AAPL"], "g1")])
            ),
            patch(f"{_CHUNKS}.mark_chunk_running", AsyncMock()),
            patch(f"{_CHUNKS}.mark_chunk_completed", AsyncMock()),
            patch(f"{_REPO}.update_job", AsyncMock()),
        ):
            await svc._run_backfill("job-7", req)

        svc._marketdata.GetDataCoverage.assert_awaited_once()
        svc._marketdata.BackfillBars.assert_awaited()

    @pytest.mark.asyncio
    async def test_resume_incomplete_jobs_returns_count(self):
        # FR-3: resume discovers jobs with PENDING/FAILED chunks and schedules a re-drive each.
        svc = make_servicer(db=MagicMock())
        with (
            patch(
                f"{_CHUNKS}.list_jobs_with_incomplete_chunks",
                AsyncMock(return_value=["resume-1", "resume-2"]),
            ),
            patch("asyncio.create_task", MagicMock(side_effect=lambda coro: coro.close())) as ct,
        ):
            count = await svc.resume_incomplete_jobs()
        assert count == 2
        assert ct.call_count == 2

    @pytest.mark.asyncio
    async def test_resume_job_redrives_incomplete_chunks(self):
        # FR-3: _resume_job re-runs a job's incomplete chunks and finalizes its status.
        svc = make_servicer(db=MagicMock())
        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(return_value=_mk_backfill_resp(7, []))
        job_row = _job_row("resume-1", ingest_pb2.BACKFILL_STATUS_RUNNING)
        job_row["timeframe_enum"] = 4  # TIMEFRAME_1DAY

        with (
            patch(f"{_REPO}.get_job", AsyncMock(return_value=job_row)),
            patch(f"{_CHUNKS}.get_incomplete_chunks", AsyncMock(return_value=[_chunk(["AAPL"])])),
            patch(f"{_CHUNKS}.mark_chunk_running", AsyncMock()),
            patch(f"{_CHUNKS}.mark_chunk_completed", AsyncMock()) as mc,
            patch(f"{_REPO}.update_job", AsyncMock()) as uj,
        ):
            await svc._resume_job("resume-1")

        mc.assert_awaited_once()  # the incomplete chunk was re-run and completed
        assert uj.await_args_list[-1].kwargs["status"] == ingest_pb2.BACKFILL_STATUS_COMPLETED


# ---------------------------------------------------------------------------
# IngestSignal — db=None path
# ---------------------------------------------------------------------------


class TestIngestSignal:
    @pytest.mark.asyncio
    async def test_aborts_when_no_db(self):
        svc = make_servicer()  # db_pool=None
        req = MagicMock()
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.IngestSignal(req, context)

        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_aborts_on_missing_source(self):
        svc = make_servicer()
        svc._db = MagicMock()  # set a non-None db so we get past that check
        req = MagicMock()
        req.signal.source = ""
        req.signal.symbol = "AAPL"
        req.signal.direction = "buy"
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.IngestSignal(req, context)

        context.abort.assert_called_once()

    @pytest.mark.asyncio
    async def test_aborts_on_invalid_direction(self):
        svc = make_servicer()
        svc._db = MagicMock()
        req = MagicMock()
        req.signal.source = "unusual_whales"
        req.signal.symbol = "AAPL"
        req.signal.direction = "unknown"
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.IngestSignal(req, context)

        context.abort.assert_called_once()

    def _make_signal_req(self, direction: str = "buy", has_valid_until: bool = False) -> MagicMock:
        """Return a MagicMock IngestSignal request with realistic field values."""
        valid_from_ts = Timestamp()
        valid_from_ts.GetCurrentTime()
        req = MagicMock()
        req.signal.source = "unusual_whales"
        req.signal.symbol = "AAPL"
        req.signal.direction = direction
        req.signal.conviction = 0.8
        req.signal.headline = "Bullish on AAPL"
        req.signal.raw_url = "https://example.com"
        req.signal.tags = ["tech"]
        req.signal.valid_from = valid_from_ts
        req.signal.HasField = MagicMock(return_value=has_valid_until)
        if has_valid_until:
            valid_until_ts = Timestamp()
            valid_until_ts.GetCurrentTime()
            req.signal.valid_until = valid_until_ts
        return req

    @pytest.mark.asyncio
    async def test_success_inserts_and_returns_id(self):
        svc = make_servicer()
        svc._db = MagicMock()
        svc._db.fetchrow = AsyncMock(return_value={"id": 42})
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        resp = await svc.IngestSignal(self._make_signal_req(), context=MagicMock())
        assert resp.signal_id == 42

    @pytest.mark.asyncio
    async def test_success_with_valid_until(self):
        svc = make_servicer()
        svc._db = MagicMock()
        svc._db.fetchrow = AsyncMock(return_value={"id": 99})
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        resp = await svc.IngestSignal(
            self._make_signal_req(has_valid_until=True), context=MagicMock()
        )
        assert resp.signal_id == 99

    @pytest.mark.asyncio
    async def test_db_error_aborts(self):
        svc = make_servicer()
        svc._db = MagicMock()
        # First fetchrow = registry lookup (returns valid row), second = INSERT raises
        svc._db.fetchrow = AsyncMock(
            side_effect=[{"slug": "unusual_whales"}, Exception("db failure")]
        )
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.IngestSignal(self._make_signal_req(), context)

        context.abort.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_ledger_error_is_swallowed(self):
        """Ledger failures should log a warning but not abort the RPC."""
        svc = make_servicer()
        svc._db = MagicMock()
        svc._db.fetchrow = AsyncMock(return_value={"id": 7})
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(side_effect=Exception("ledger down"))

        resp = await svc.IngestSignal(self._make_signal_req(), context=MagicMock())
        assert resp.signal_id == 7


# ---------------------------------------------------------------------------
# QuerySignals — db=None abort path
# ---------------------------------------------------------------------------


class TestQuerySignals:
    @pytest.mark.asyncio
    async def test_aborts_when_no_db(self):
        svc = make_servicer()
        req = MagicMock()
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.QuerySignals(req, context)

        context.abort.assert_called_once()


# ---------------------------------------------------------------------------
# ConfigWatcher getters
# ---------------------------------------------------------------------------


class _StubWatcher(ConfigWatcher):
    """ConfigWatcher subclass that skips gRPC init for unit testing getters."""

    def __init__(self):
        # Bypass __init__ — set attributes directly
        self.endpoint = "localhost:50060"
        self.namespace = "ingest"
        self._snapshot = None
        self._snapshot_event = asyncio.Event()


class TestConfigWatcherGetters:
    def test_get_str_returns_default_when_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_str("any.key", default="fallback") == "fallback"

    def test_get_str_returns_default_when_key_missing(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_str("missing.key", default="d") == "d"

    def test_get_str_returns_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["my.key"].CopyFrom(config_pb2.ConfigValue(string_val="hello"))
        w._snapshot = snap
        assert w.get_str("my.key") == "hello"

    def test_get_int_returns_default_when_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_int("any.key", default=99) == 99

    def test_get_int_returns_default_when_key_missing(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_int("missing.int", default=7) == 7

    def test_get_int_returns_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["limit"].CopyFrom(config_pb2.ConfigValue(int_val=42))
        w._snapshot = snap
        assert w.get_int("limit") == 42

    def test_get_bool_returns_default_when_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_bool("flag", default=True) is True

    def test_get_bool_returns_default_when_key_missing(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_bool("missing.bool", default=True) is True

    def test_get_bool_returns_value_when_set(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["flag"].CopyFrom(config_pb2.ConfigValue(bool_val=True))
        w._snapshot = snap
        assert w.get_bool("flag") is True

    def test_get_float_returns_default_when_no_snapshot(self):
        w = _StubWatcher()
        assert w.get_float("rate", default=1.5) == 1.5

    def test_get_float_returns_default_when_key_missing(self):
        w = _StubWatcher()
        w._snapshot = config_pb2.ConfigSnapshot()
        assert w.get_float("missing.float", default=2.5) == 2.5

    def test_get_float_returns_value(self):
        w = _StubWatcher()
        snap = config_pb2.ConfigSnapshot()
        snap.values["rate"].CopyFrom(config_pb2.ConfigValue(float_val=0.75))
        w._snapshot = snap
        assert w.get_float("rate") == 0.75

    def test_sandbox_timeout_default(self):
        w = _StubWatcher()
        assert w.sandbox_timeout_ms == 5000

    def test_sandbox_memory_default(self):
        w = _StubWatcher()
        assert w.sandbox_memory_bytes == 128 * 1024 * 1024

    def test_sandbox_allowed_imports_default(self):
        w = _StubWatcher()
        imports = w.sandbox_allowed_imports
        assert "numpy" in imports
        assert "pandas" in imports

    def test_backfill_max_concurrent_jobs_default(self):
        assert _StubWatcher().backfill_max_concurrent_jobs == 3

    def test_backfill_retry_on_failure_default(self):
        assert _StubWatcher().backfill_retry_on_failure is True

    def test_backfill_max_retry_attempts_default(self):
        assert _StubWatcher().backfill_max_retry_attempts == 3

    @pytest.mark.asyncio
    async def test_wait_for_snapshot_succeeds_when_event_set(self):
        w = _StubWatcher()
        w._snapshot_event.set()
        await w.wait_for_snapshot(timeout_seconds=1.0)  # should not raise

    @pytest.mark.asyncio
    async def test_wait_for_snapshot_raises_on_timeout(self):
        w = _StubWatcher()
        # Event is never set → times out immediately
        with pytest.raises(RuntimeError, match="Timed out"):
            await w.wait_for_snapshot(timeout_seconds=0.01)


# ---------------------------------------------------------------------------
# IngestSignal — registry slug validation (FR-3)
# ---------------------------------------------------------------------------


class TestIngestSignalRegistryValidation:
    def _make_signal_req(self, source: str = "unusual_whales") -> ingest_pb2.IngestSignalRequest:
        ts = Timestamp()
        ts.GetCurrentTime()
        signal = ingest_pb2.ExternalSignal(
            source=source, symbol="AAPL", direction="buy", valid_from=ts
        )
        return ingest_pb2.IngestSignalRequest(signal=signal)

    @pytest.mark.asyncio
    async def test_aborts_when_source_not_registered(self):
        svc = make_servicer()
        svc._db = MagicMock()
        # Registry lookup returns None → unregistered source
        svc._db.fetchrow = AsyncMock(return_value=None)
        context = MagicMock()
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.IngestSignal(self._make_signal_req(), context)

        context.abort.assert_awaited_once()
        args = context.abort.call_args[0]
        import grpc

        assert args[0] == grpc.StatusCode.INVALID_ARGUMENT

    @pytest.mark.asyncio
    async def test_proceeds_when_source_registered(self):
        svc = make_servicer()
        svc._db = MagicMock()
        # First fetchrow = registry lookup (returns slug row), second = INSERT signal
        svc._db.fetchrow = AsyncMock(side_effect=[{"slug": "unusual_whales"}, {"id": 42}])
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        resp = await svc.IngestSignal(self._make_signal_req(), context=MagicMock())
        assert resp.signal_id == 42


# ---------------------------------------------------------------------------
# ManageSignalSource — auth + CRUD paths
# ---------------------------------------------------------------------------


class TestManageSignalSource:
    @pytest.mark.asyncio
    async def test_permission_denied_without_admin_scope(self):
        svc = make_servicer()
        svc._db = MagicMock()

        req = ingest_pb2.ManageSignalSourceRequest(
            source=ingest_pb2.SignalSource(slug="s", source_type="simple_email"),
            operation="register",
        )
        context = MagicMock()
        # x-access-scope without the ADMIN bit (0x04)
        context.invocation_metadata = MagicMock(return_value=[("x-access-scope", "1")])
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageSignalSource(req, context)

        import grpc

        assert context.abort.call_args[0][0] == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_permission_denied_without_scope_header(self):
        svc = make_servicer()
        svc._db = MagicMock()

        req = ingest_pb2.ManageSignalSourceRequest(
            source=ingest_pb2.SignalSource(slug="s", source_type="simple_email"),
            operation="register",
        )
        context = MagicMock()
        context.invocation_metadata = MagicMock(return_value=[])
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageSignalSource(req, context)

        import grpc

        assert context.abort.call_args[0][0] == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_register_succeeds_with_admin_scope(self):
        svc = make_servicer()
        svc._db = MagicMock()
        svc._db.fetchrow = AsyncMock(
            return_value={
                "slug": "uw",
                "display_name": "UW",
                "source_type": "simple_email",
                "extractor_module": "app.extractors.noop",
                "credentials_ref": None,
                "active": True,
                "config_json": None,
            }
        )

        from google.protobuf.struct_pb2 import Struct

        cfg = Struct()
        cfg.update({"sender_patterns": ["@x.com"], "subject_patterns": ["Alert"]})
        req = ingest_pb2.ManageSignalSourceRequest(
            source=ingest_pb2.SignalSource(
                slug="uw",
                display_name="UW",
                source_type="simple_email",
                extractor_module="app.extractors.noop",
                config_json=cfg,
            ),
            credentials_ref="",
            operation="register",
        )
        context = MagicMock()
        # x-access-scope with the ADMIN bit set (7 = 0b111)
        context.invocation_metadata = MagicMock(return_value=[("x-access-scope", "7")])

        resp = await svc.ManageSignalSource(req, context)
        assert resp.source.slug == "uw"

    @pytest.mark.asyncio
    async def test_deactivate_not_found(self):
        svc = make_servicer()
        svc._db = MagicMock()
        svc._db.fetchrow = AsyncMock(return_value=None)

        req = ingest_pb2.ManageSignalSourceRequest(
            source=ingest_pb2.SignalSource(slug="missing"),
            operation="deactivate",
        )
        context = MagicMock()
        context.invocation_metadata = MagicMock(return_value=[("x-access-scope", "7")])
        context.abort = AsyncMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.ManageSignalSource(req, context)

        import grpc

        assert context.abort.call_args[0][0] == grpc.StatusCode.NOT_FOUND


# ---------------------------------------------------------------------------
# ListSignalSources
# ---------------------------------------------------------------------------


class TestListSignalSources:
    @pytest.mark.asyncio
    async def test_returns_sources_active_only(self):
        svc = make_servicer()
        svc._db = MagicMock()
        svc._db.fetch = AsyncMock(
            return_value=[
                {
                    "slug": "uw",
                    "display_name": "UW",
                    "source_type": "simple_email",
                    "extractor_module": "app.extractors.noop",
                    "credentials_ref": None,
                    "active": True,
                    "config_json": None,
                    "created_at": None,
                }
            ]
        )

        req = ingest_pb2.ListSignalSourcesRequest(include_inactive=False)
        resp = await svc.ListSignalSources(req, context=MagicMock())
        assert len(resp.sources) == 1
        assert resp.sources[0].slug == "uw"
        assert resp.sources[0].has_credentials is False

    @pytest.mark.asyncio
    async def test_has_credentials_true_when_ref_set(self):
        svc = make_servicer()
        svc._db = MagicMock()
        svc._db.fetch = AsyncMock(
            return_value=[
                {
                    "slug": "aw",
                    "display_name": "AW",
                    "source_type": "authenticated_website",
                    "extractor_module": "app.extractors.noop",
                    "credentials_ref": "secret.aw.token",
                    "active": True,
                    "config_json": None,
                    "created_at": None,
                }
            ]
        )

        req = ingest_pb2.ListSignalSourcesRequest(include_inactive=False)
        resp = await svc.ListSignalSources(req, context=MagicMock())
        assert resp.sources[0].has_credentials is True
