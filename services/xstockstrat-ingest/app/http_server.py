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

    @app.post("/xstockstrat.ingest.v1.IngestService/IngestSignal")
    async def ingest_signal(request: Request):
        return await _call(request, ingest_pb2.IngestSignalRequest,
                           servicer.IngestSignal)

    @app.post("/xstockstrat.ingest.v1.IngestService/QuerySignals")
    async def query_signals(request: Request):
        return await _call(request, ingest_pb2.QuerySignalsRequest,
                           servicer.QuerySignals)

    # ── n8n webhook routes ────────────────────────────────────────────────────
    @app.post("/webhooks/n8n/trigger-backfill")
    async def n8n_trigger_backfill(request: Request):
        """n8n → TriggerBackfill webhook."""
        body = await request.json()
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

    @app.post("/webhooks/n8n/ingest-signal")
    async def n8n_ingest_signal(request: Request):
        """
        n8n → IngestSignal webhook.
        Expected payload:
        {
          "source": "unusual_whales",
          "symbol": "NVDA",
          "direction": "buy",
          "conviction": 0.8,           // optional, 0.0–1.0
          "valid_from": "2024-11-01T00:00:00Z",
          "valid_until": "2024-11-10T00:00:00Z",  // optional
          "headline": "Large call sweep detected on NVDA",
          "raw_url": "https://unusualwhales.com/...",  // optional
          "tags": ["unusual_options", "large_sweep"]  // optional
        }
        """
        body = await request.json()
        from google.protobuf.timestamp_pb2 import Timestamp
        from datetime import datetime, timezone

        def _parse_ts(s: str | None) -> Timestamp | None:
            if not s:
                return None
            ts = Timestamp()
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            ts.FromDatetime(dt)
            return ts

        valid_from_ts = _parse_ts(body.get("valid_from"))
        if valid_from_ts is None:
            raise HTTPException(status_code=400, detail="valid_from is required")

        signal = ingest_pb2.ExternalSignal(
            source=body.get("source", ""),
            symbol=body.get("symbol", ""),
            direction=body.get("direction", ""),
            conviction=float(body.get("conviction", 0.0)),
            headline=body.get("headline", ""),
            raw_url=body.get("raw_url", ""),
            tags=body.get("tags", []),
        )
        signal.valid_from.CopyFrom(valid_from_ts)
        valid_until_ts = _parse_ts(body.get("valid_until"))
        if valid_until_ts:
            signal.valid_until.CopyFrom(valid_until_ts)

        req_msg = ingest_pb2.IngestSignalRequest(signal=signal)
        resp = await servicer.IngestSignal(req_msg, _NoopContext())
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
