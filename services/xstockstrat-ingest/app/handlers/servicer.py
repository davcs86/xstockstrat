"""
IngestServicer — orchestrates historical backfills via xstockstrat-marketdata
and normalises raw data payloads before writing to the ledger.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone

import grpc

from app.config.watcher import ConfigWatcher
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc

log = logging.getLogger(__name__)


class IngestServicer(ingest_pb2_grpc.IngestServiceServicer):

    def __init__(self, config_watcher: ConfigWatcher, marketdata_channel, ledger_channel):
        self._cfg = config_watcher
        self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)
        self._ledger = ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
        self._jobs: dict[str, ingest_pb2.BackfillJob] = {}

    async def TriggerBackfill(self, request, context):
        job_id = str(uuid.uuid4())
        job = ingest_pb2.BackfillJob(
            job_id=job_id,
            symbols=list(request.symbols),
            timeframe=request.timeframe,
            range=request.range,
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )
        self._jobs[job_id] = job
        asyncio.create_task(self._run_backfill(job_id, request))
        return ingest_pb2.TriggerBackfillResponse(
            job_id=job_id,
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )

    async def _run_backfill(self, job_id: str, request):
        job = self._jobs[job_id]
        job.status = ingest_pb2.BACKFILL_STATUS_RUNNING
        log.info("backfill job %s starting symbols=%s", job_id, list(request.symbols))

        try:
            resp = await self._marketdata.BackfillBars(
                marketdata_pb2.BackfillBarsRequest(
                    symbols=list(request.symbols),
                    timeframe=request.timeframe,
                    range=request.range,
                    overwrite_existing=request.overwrite,
                )
            )
            job.bars_processed = resp.bars_written
            job.status = (
                ingest_pb2.BACKFILL_STATUS_PARTIAL
                if resp.failed_symbols
                else ingest_pb2.BACKFILL_STATUS_COMPLETED
            )
            log.info("backfill job %s completed bars=%d failed=%s", job_id, resp.bars_written, resp.failed_symbols)

            # Emit ledger event
            from google.protobuf.struct_pb2 import Struct
            payload = Struct()
            payload.update({
                "job_id": job_id,
                "symbols": list(request.symbols),
                "bars_written": resp.bars_written,
                "failed_symbols": list(resp.failed_symbols),
            })
            await self._ledger.AppendEvent(ledger_pb2.AppendEventRequest(
                event_type="ingest.backfill.completed",
                source_service="xstockstrat-ingest",
                stream_key=f"backfill:{job_id}",
                payload=payload,
            ))
        except Exception as e:
            job.status = ingest_pb2.BACKFILL_STATUS_FAILED
            job.error = str(e)
            log.error("backfill job %s failed: %s", job_id, e)

    async def GetBackfillStatus(self, request, context):
        job = self._jobs.get(request.job_id)
        if job is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"job {request.job_id} not found")
            return
        return job

    async def ListBackfillJobs(self, request, context):
        jobs = list(self._jobs.values())
        if request.status_filter != ingest_pb2.BACKFILL_STATUS_UNSPECIFIED:
            jobs = [j for j in jobs if j.status == request.status_filter]
        return ingest_pb2.ListBackfillJobsResponse(jobs=jobs)

    async def NormalizeRawData(self, request, context):
        # Normalise CSV/JSON/alpaca_v2 payloads into ledger events
        rows = 0
        errors = []
        try:
            if request.format == "csv":
                rows = await self._normalize_csv(request.raw_data)
            elif request.format in ("json", "alpaca_v2"):
                rows = await self._normalize_json(request.raw_data, request.format)
            else:
                errors.append(f"Unknown format: {request.format}")
        except Exception as e:
            errors.append(str(e))
        return ingest_pb2.NormalizeRawDataResponse(rows_normalized=rows, errors=errors)

    async def _normalize_csv(self, raw: bytes) -> int:
        import csv, io
        reader = csv.DictReader(io.StringIO(raw.decode()))
        count = sum(1 for _ in reader)
        return count

    async def _normalize_json(self, raw: bytes, fmt: str) -> int:
        import json
        data = json.loads(raw)
        return len(data) if isinstance(data, list) else 1
