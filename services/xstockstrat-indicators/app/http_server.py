"""
Connect-RPC compatible HTTP server for xstockstrat-indicators.

Exposes the IndicatorsService methods via HTTP POST using JSON encoding,
matching the Connect-RPC protocol:
  POST /{package}.{Service}/{Method}
  Content-Type: application/json
  Body: JSON-encoded request proto
  Response: JSON-encoded response proto

Also exposes:
  GET /healthz                          → 200 OK
"""

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from gen.indicators.v1 import indicators_pb2
from google.protobuf import json_format
from google.protobuf.message import DecodeError

log = logging.getLogger(__name__)


def build_app(servicer) -> FastAPI:
    app = FastAPI(title="xstockstrat-indicators HTTP", docs_url=None, redoc_url=None)

    # ── Health ────────────────────────────────────────────────────────────────
    @app.get("/healthz")
    async def healthz():
        return {"status": "ok", "service": "xstockstrat-indicators"}

    # ── Connect-RPC compatible routes ─────────────────────────────────────────
    @app.post("/xstockstrat.indicators.v1.IndicatorsService/ComputeIndicator")
    async def compute_indicator(request: Request):
        return await _call(
            request, indicators_pb2.ComputeIndicatorRequest, servicer.ComputeIndicator
        )

    @app.post("/xstockstrat.indicators.v1.IndicatorsService/ExecuteFormula")
    async def execute_formula(request: Request):
        return await _call(request, indicators_pb2.ExecuteFormulaRequest, servicer.ExecuteFormula)

    @app.post("/xstockstrat.indicators.v1.IndicatorsService/ListIndicators")
    async def list_indicators(request: Request):
        return await _call(request, indicators_pb2.ListIndicatorsRequest, servicer.ListIndicators)

    @app.post("/xstockstrat.indicators.v1.IndicatorsService/RegisterFormula")
    async def register_formula(request: Request):
        return await _call(request, indicators_pb2.RegisterFormulaRequest, servicer.RegisterFormula)

    @app.post("/xstockstrat.indicators.v1.IndicatorsService/GetFormula")
    async def get_formula(request: Request):
        return await _call(request, indicators_pb2.GetFormulaRequest, servicer.GetFormula)

    return app


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _call(request: Request, req_cls, handler_fn):
    """Deserialise JSON body into req_cls proto, call handler, return JSON."""
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
    """Minimal stand-in for grpc.aio.ServicerContext when called from HTTP."""

    async def abort(self, code, details):
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail=details)

    async def send_initial_metadata(self, *args, **kwargs):
        pass
