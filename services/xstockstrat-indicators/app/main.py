"""
xstockstrat-indicators — gRPC + HTTP server entry point.

Formula engine + sandboxed Python execution.
Timeout and memory cap sourced from xstockstrat-config at startup.

Ports:
  GRPC_PORT (50054)  — gRPC (HTTP/2), internal service-to-service
  HTTP_PORT (8054)   — Connect-RPC compatible HTTP (JSON), browser + external clients
"""
import asyncio
import logging
import os
import signal

import grpc
import uvicorn
from gen.indicators.v1 import indicators_pb2_grpc
from gen.indicators.v1.indicators_pb2 import DESCRIPTOR as INDICATORS_DESCRIPTOR
from grpc_reflection.v1alpha import reflection

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import IndicatorsServicer
from app.http_server import build_app
from app.telemetry import init_telemetry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger(__name__)

GRPC_PORT = os.environ.get("GRPC_PORT", "50054")
HTTP_PORT = int(os.environ.get("HTTP_PORT", "8054"))
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")


async def start_http_server(servicer: IndicatorsServicer) -> None:
    """Start FastAPI HTTP server on HTTP_PORT (Connect-RPC compatible JSON API)."""
    app = build_app(servicer)
    config = uvicorn.Config(
        app=app,
        host="0.0.0.0",
        port=HTTP_PORT,
        loop="asyncio",
        log_level="info",
    )
    server = uvicorn.Server(config)
    log.info("indicators HTTP service starting on port %d", HTTP_PORT)
    await server.serve()


async def serve():
    init_telemetry()

    # Subscribe to config before accepting traffic
    log.info("connecting to config service at %s", CONFIG_ENDPOINT)
    config_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="indicators")
    await config_watcher.wait_for_snapshot(timeout_seconds=10)
    log.info("config snapshot received")

    servicer = IndicatorsServicer(config_watcher=config_watcher)

    # ── gRPC server (internal, port 50054) ────────────────────────────────
    grpc_server = grpc.aio.server()
    indicators_pb2_grpc.add_IndicatorsServiceServicer_to_server(servicer, grpc_server)

    service_names = (
        INDICATORS_DESCRIPTOR.services_by_name["IndicatorsService"].full_name,
        reflection.SERVICE_NAME,
    )
    reflection.enable_server_reflection(service_names, grpc_server)

    grpc_server.add_insecure_port(f"[::]:{GRPC_PORT}")
    log.info("indicators gRPC service starting on port %s", GRPC_PORT)
    await grpc_server.start()

    def handle_shutdown(sig, frame):
        log.info("received signal %s, shutting down", sig)
        asyncio.get_event_loop().create_task(grpc_server.stop(grace=5))

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    # Run both servers concurrently
    await asyncio.gather(
        grpc_server.wait_for_termination(),
        start_http_server(servicer),
    )


if __name__ == "__main__":
    asyncio.run(serve())
