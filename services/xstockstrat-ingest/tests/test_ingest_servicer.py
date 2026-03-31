"""
Unit tests for IngestServicer — no gRPC connections required.

The servicer is instantiated with MagicMock channels; internal state
(_jobs, _db) is manipulated directly to exercise business logic without
a running gRPC server or database.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from gen.common.v1 import common_pb2
from gen.config.v1 import config_pb2
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc  # noqa: F401 (imported via conftest path)
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import IngestServicer


def make_servicer() -> IngestServicer:
    """Return an IngestServicer with fully mocked dependencies."""
    cfg = MagicMock()
    marketdata_ch = MagicMock()
    ledger_ch = MagicMock()
    return IngestServicer(cfg, marketdata_ch, ledger_ch, db_pool=None)


# ---------------------------------------------------------------------------
# ListBackfillJobs
# ---------------------------------------------------------------------------


class TestListBackfillJobs:
    def _make_job(self, job_id: str, status: int) -> ingest_pb2.BackfillJob:
        return ingest_pb2.BackfillJob(
            job_id=job_id,
            symbols=["AAPL"],
            status=status,
        )

    @pytest.mark.asyncio
    async def test_returns_all_jobs_when_no_filter(self):
        svc = make_servicer()
        svc._jobs["j1"] = self._make_job("j1", ingest_pb2.BACKFILL_STATUS_QUEUED)
        svc._jobs["j2"] = self._make_job("j2", ingest_pb2.BACKFILL_STATUS_COMPLETED)

        req = ingest_pb2.ListBackfillJobsRequest(
            status_filter=ingest_pb2.BACKFILL_STATUS_UNSPECIFIED
        )
        resp = await svc.ListBackfillJobs(req, context=MagicMock())
        assert len(resp.jobs) == 2

    @pytest.mark.asyncio
    async def test_filters_by_status(self):
        svc = make_servicer()
        svc._jobs["j1"] = self._make_job("j1", ingest_pb2.BACKFILL_STATUS_QUEUED)
        svc._jobs["j2"] = self._make_job("j2", ingest_pb2.BACKFILL_STATUS_COMPLETED)
        svc._jobs["j3"] = self._make_job("j3", ingest_pb2.BACKFILL_STATUS_COMPLETED)

        req = ingest_pb2.ListBackfillJobsRequest(status_filter=ingest_pb2.BACKFILL_STATUS_COMPLETED)
        resp = await svc.ListBackfillJobs(req, context=MagicMock())
        assert len(resp.jobs) == 2
        assert all(j.status == ingest_pb2.BACKFILL_STATUS_COMPLETED for j in resp.jobs)

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_jobs(self):
        svc = make_servicer()
        req = ingest_pb2.ListBackfillJobsRequest(
            status_filter=ingest_pb2.BACKFILL_STATUS_UNSPECIFIED
        )
        resp = await svc.ListBackfillJobs(req, context=MagicMock())
        assert len(resp.jobs) == 0


# ---------------------------------------------------------------------------
# GetBackfillStatus
# ---------------------------------------------------------------------------


class TestGetBackfillStatus:
    @pytest.mark.asyncio
    async def test_returns_job_when_found(self):
        svc = make_servicer()
        job = ingest_pb2.BackfillJob(
            job_id="job-abc",
            symbols=["TSLA"],
            status=ingest_pb2.BACKFILL_STATUS_RUNNING,
        )
        svc._jobs["job-abc"] = job

        req = ingest_pb2.GetBackfillStatusRequest(job_id="job-abc")
        context = MagicMock()
        result = await svc.GetBackfillStatus(req, context)
        assert result.job_id == "job-abc"
        assert result.status == ingest_pb2.BACKFILL_STATUS_RUNNING

    @pytest.mark.asyncio
    async def test_aborts_when_not_found(self):
        svc = make_servicer()
        req = ingest_pb2.GetBackfillStatusRequest(job_id="missing-job")
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.GetBackfillStatus(req, context)

        context.abort.assert_called_once()


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
    async def test_creates_job_and_returns_queued(self):
        svc = make_servicer()
        req = MagicMock()
        req.symbols = ["AAPL", "TSLA"]
        req.timeframe = "1d"
        req.range = common_pb2.TimeRange()

        with patch("asyncio.create_task"):
            resp = await svc.TriggerBackfill(req, context=MagicMock())

        assert resp.status == ingest_pb2.BACKFILL_STATUS_QUEUED
        assert resp.job_id != ""
        assert resp.job_id in svc._jobs

    @pytest.mark.asyncio
    async def test_job_stored_in_dict(self):
        svc = make_servicer()
        req = MagicMock()
        req.symbols = ["MSFT"]
        req.timeframe = "1h"
        req.range = common_pb2.TimeRange()

        with patch("asyncio.create_task"):
            resp = await svc.TriggerBackfill(req, context=MagicMock())

        stored = svc._jobs[resp.job_id]
        assert stored.status == ingest_pb2.BACKFILL_STATUS_QUEUED
        assert "MSFT" in stored.symbols


# ---------------------------------------------------------------------------
# _run_backfill — internal async job runner
# ---------------------------------------------------------------------------


class TestRunBackfill:
    @pytest.mark.asyncio
    async def test_success_sets_completed_status(self):
        svc = make_servicer()

        mock_resp = MagicMock()
        mock_resp.bars_written = 100
        mock_resp.failed_symbols = []
        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(return_value=mock_resp)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        job_id = "test-job-1"
        svc._jobs[job_id] = ingest_pb2.BackfillJob(
            job_id=job_id,
            symbols=["AAPL"],
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )
        req = MagicMock()
        req.symbols = ["AAPL"]
        req.timeframe = "1d"
        req.overwrite = False
        req.range = common_pb2.TimeRange()

        await svc._run_backfill(job_id, req)

        assert svc._jobs[job_id].status == ingest_pb2.BACKFILL_STATUS_COMPLETED
        assert svc._jobs[job_id].bars_processed == 100

    @pytest.mark.asyncio
    async def test_partial_when_failed_symbols(self):
        svc = make_servicer()

        mock_resp = MagicMock()
        mock_resp.bars_written = 50
        mock_resp.failed_symbols = ["TSLA"]
        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(return_value=mock_resp)
        svc._ledger = MagicMock()
        svc._ledger.AppendEvent = AsyncMock(return_value=MagicMock())

        job_id = "test-job-2"
        svc._jobs[job_id] = ingest_pb2.BackfillJob(
            job_id=job_id,
            symbols=["AAPL", "TSLA"],
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )
        req = MagicMock()
        req.symbols = ["AAPL", "TSLA"]
        req.timeframe = "1d"
        req.overwrite = False
        req.range = common_pb2.TimeRange()

        await svc._run_backfill(job_id, req)

        assert svc._jobs[job_id].status == ingest_pb2.BACKFILL_STATUS_PARTIAL

    @pytest.mark.asyncio
    async def test_failure_sets_failed_status(self):
        svc = make_servicer()

        svc._marketdata = MagicMock()
        svc._marketdata.BackfillBars = AsyncMock(side_effect=Exception("network error"))
        svc._ledger = MagicMock()

        job_id = "test-job-3"
        svc._jobs[job_id] = ingest_pb2.BackfillJob(
            job_id=job_id,
            symbols=["AAPL"],
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )
        req = MagicMock()
        req.symbols = ["AAPL"]
        req.timeframe = "1d"
        req.overwrite = False
        req.range = common_pb2.TimeRange()

        await svc._run_backfill(job_id, req)

        assert svc._jobs[job_id].status == ingest_pb2.BACKFILL_STATUS_FAILED
        assert "network error" in svc._jobs[job_id].error


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
        svc._db.fetchrow = AsyncMock(side_effect=Exception("db failure"))
        context = MagicMock()
        context.abort = MagicMock(side_effect=Exception("aborted"))

        with pytest.raises(Exception, match="aborted"):
            await svc.IngestSignal(self._make_signal_req(), context)

        context.abort.assert_called_once()

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
