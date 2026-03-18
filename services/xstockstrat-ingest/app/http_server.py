"""
Connect-RPC compatible HTTP server for xstockstrat-ingest.

Exposes IngestService methods via HTTP POST (JSON encoding) and n8n webhooks.
"""
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from google.protobuf import json_format
from google.protobuf.message import DecodeError

from gen.ingest.v1 import ingest_pb2

log = logging.getLogger(__name__)


def build_app(servicer) -> FastAPI:
    app = FastAPI(title="xstockstrat-ingest HTTP", docs_url=None, redoc_url=None)

    # ── Health ────────────────────────────────────────────────────────────────
    @app.get("/healthz")
    async def healthz():
        return {"status": "ok", "service": "xstockstrat-ingest"}

    # ── Connect-RPC compatible routes ─────────────────────────────────────────
    @app.post("/xstockstrat.ingest.v1.IngestService/TriggerBackfill")
    async def trigger_backfill(request: Request):
        return await _call(request, ingest_pb2.TriggerBackfillRequest,
                           servicer.TriggerBackfill)

    @app.post("/xstockstrat.ingest.v1.IngestService/GetBackfillStatus")
    async def get_backfill_status(request: Request):
        return await _call(request, ingest_pb2.GetBackfillStatusRequest,
                           servicer.GetBackfillStatus)

    @app.post("/xstockstrat.ingest.v1.IngestService/ListBackfillJobs")
    async def list_backfill_jobs(request: Request):
        return await _call(request, ingest_pb2.ListBackfillJobsRequest,
                           servicer.ListBackfillJobs)

    @app.post("/xstockstrat.ingest.v1.IngestService/NormalizeRawData")
    async def normalize_raw_data(request: Request):
        return await _call(request, ingest_pb2.NormalizeRawDataRequest,
                           servicer.NormalizeRawData)

    # ── n8n webhook routes ────────────────────────────────────────────────────
    @app.post("/webhooks/n8n/trigger-backfill")
    async def n8n_trigger_backfill(request: Request):
        """n8n → TriggerBackfill webhook."""
        body = await request.json()
        from google.protobuf.timestamp_pb2 import Timestamp
        from gen.common.v1 import common_pb2
        import time as _time
        req_msg = ingest_pb2.TriggerBackfillRequest(
            symbols=body.get("symbols", []),
            timeframe=body.get("timeframe", "1Day"),
            overwrite=body.get("overwrite", False),
        )
        resp = await servicer.TriggerBackfill(req_msg, _NoopContext())
        return JSONResponse(json_format.MessageToDict(resp))

    @app.post("/webhooks/n8n/backfill-status")
    async def n8n_backfill_status(request: Request):
        """n8n → GetBackfillStatus webhook."""
        body = await request.json()
        req_msg = ingest_pb2.GetBackfillStatusRequest(job_id=body.get("job_id", ""))
        resp = await servicer.GetBackfillStatus(req_msg, _NoopContext())
        return JSONResponse(json_format.MessageToDict(resp))

    return app


async def _call(request: Request, req_cls, handler_fn):
    try:
        body = await request.body()
        req_msg = json_format.Parse(body or b"{}", req_cls())
    except (DecodeError, Exception) as e:
        raise HTTPException(status_code=400, detail=f"invalid request: {e}")

    resp = await handler_fn(req_msg, _NoopContext())
    if resp is None:
        raise HTTPException(status_code=500, detail="handler returned None")
    return JSONResponse(json_format.MessageToDict(resp))


class _NoopContext:
    async def abort(self, code, details):
        raise HTTPException(status_code=400, detail=details)

    async def send_initial_metadata(self, *args, **kwargs):
        pass
