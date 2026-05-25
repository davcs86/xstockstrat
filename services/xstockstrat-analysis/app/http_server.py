"""
Connect-RPC compatible HTTP server for xstockstrat-analysis.

Exposes AnalysisService methods via HTTP POST (JSON encoding) and webhooks.
"""

import logging
import os as _os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from gen.analysis.v1 import analysis_pb2
from google.protobuf import json_format
from google.protobuf.message import DecodeError
from starlette.responses import Response as _Response

log = logging.getLogger(__name__)

_MCP_AGENT_SECRET = _os.environ.get("MCP_AGENT_SECRET", "")


def build_app(servicer) -> FastAPI:
    app = FastAPI(title="xstockstrat-analysis HTTP", docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def enforce_mcp_secret(request: Request, call_next):
        if _MCP_AGENT_SECRET and request.url.path.startswith("/webhooks/"):
            if request.headers.get("x-mcp-secret") != _MCP_AGENT_SECRET:
                return _Response("Unauthorized", status_code=401)
        return await call_next(request)

    # ── Health ────────────────────────────────────────────────────────────────
    @app.get("/healthz")
    async def healthz():
        return {"status": "ok", "service": "xstockstrat-analysis"}

    # ── Connect-RPC compatible routes ─────────────────────────────────────────
    @app.post("/xstockstrat.analysis.v1.AnalysisService/RunBacktest")
    async def run_backtest(request: Request):
        return await _call(request, analysis_pb2.RunBacktestRequest, servicer.RunBacktest)

    @app.post("/xstockstrat.analysis.v1.AnalysisService/ScoreStrategy")
    async def score_strategy(request: Request):
        return await _call(request, analysis_pb2.ScoreStrategyRequest, servicer.ScoreStrategy)

    @app.post("/xstockstrat.analysis.v1.AnalysisService/ListStrategies")
    async def list_strategies(request: Request):
        return await _call(request, analysis_pb2.ListStrategiesRequest, servicer.ListStrategies)

    @app.post("/xstockstrat.analysis.v1.AnalysisService/GetStrategyReport")
    async def get_strategy_report(request: Request):
        return await _call(
            request, analysis_pb2.GetStrategyReportRequest, servicer.GetStrategyReport
        )

    # ── Webhook routes ──────────────────────────────────────────────────────────
    @app.post("/webhooks/run-backtest")
    async def run_backtest_webhook(request: Request):
        """Webhook → RunBacktest."""
        body = await request.json()
        req_msg = analysis_pb2.RunBacktestRequest(
            strategy_id=body.get("strategy_id", ""),
            symbols=body.get("symbols", []),
            initial_capital=body.get("initial_capital", 100000.0),
        )
        resp = await servicer.RunBacktest(req_msg, _NoopContext())
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
