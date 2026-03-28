"""
xstockstrat-analysis — Strategy scoring and backtesting service.

Ports:
  GRPC_PORT (50056)  — gRPC (HTTP/2), internal service-to-service
  HTTP_PORT (8056)   — Connect-RPC compatible HTTP (JSON), browser + external clients
"""
import asyncio
import logging
import os
import signal

import grpc
import uvicorn
from gen.analysis.v1 import analysis_pb2_grpc
from gen.analysis.v1.analysis_pb2 import DESCRIPTOR as ANALYSIS_DESCRIPTOR
from grpc_reflection.v1alpha import reflection

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer
from app.http_server import build_app
from app.telemetry import init_telemetry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

GRPC_PORT = os.environ.get("GRPC_PORT", "50056")
HTTP_PORT = int(os.environ.get("HTTP_PORT", "8056"))
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")
MARKETDATA_ENDPOINT = os.environ.get("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053")
INDICATORS_ENDPOINT = os.environ.get("INDICATORS_ENDPOINT", "xstockstrat-indicators:50054")
INGEST_ENDPOINT = os.environ.get("INGEST_ENDPOINT", "xstockstrat-ingest:50055")
LEDGER_ENDPOINT = os.environ.get("LEDGER_ENDPOINT", "xstockstrat-ledger:50057")


async def start_http_server(servicer: AnalysisServicer) -> None:
    """Start FastAPI HTTP server on HTTP_PORT (Connect-RPC compatible JSON API)."""
    app = build_app(servicer)
    config = uvicorn.Config(
        app=app, host="0.0.0.0", port=HTTP_PORT, loop="asyncio", log_level="info"
    )
    server = uvicorn.Server(config)
    log.info("analysis HTTP service starting on port %d", HTTP_PORT)
    await server.serve()


async def serve():
    init_telemetry()

    cfg_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="analysis")
    await cfg_watcher.wait_for_snapshot(timeout_seconds=10)
    log.info("config snapshot received")

    servicer = AnalysisServicer(
        config_watcher=cfg_watcher,
        marketdata_channel=grpc.aio.insecure_channel(MARKETDATA_ENDPOINT),
        indicators_channel=grpc.aio.insecure_channel(INDICATORS_ENDPOINT),
        ingest_channel=grpc.aio.insecure_channel(INGEST_ENDPOINT),
        ledger_channel=grpc.aio.insecure_channel(LEDGER_ENDPOINT),
    )

    # ── gRPC server (internal, port 50056) ────────────────────────────────
    grpc_server = grpc.aio.server()
    analysis_pb2_grpc.add_AnalysisServiceServicer_to_server(servicer, grpc_server)

    service_names = (
        ANALYSIS_DESCRIPTOR.services_by_name["AnalysisService"].full_name,
        reflection.SERVICE_NAME,
    )
    reflection.enable_server_reflection(service_names, grpc_server)

    grpc_server.add_insecure_port(f"[::]:{GRPC_PORT}")
    log.info("analysis gRPC service starting on port %s", GRPC_PORT)
    await grpc_server.start()

    def handle_shutdown(sig, _):
        asyncio.get_event_loop().create_task(grpc_server.stop(grace=5))

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    await asyncio.gather(
        grpc_server.wait_for_termination(),
        start_http_server(servicer),
    )


if __name__ == "__main__":
    asyncio.run(serve())
