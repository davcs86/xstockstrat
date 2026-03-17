"""
xstockstrat-ingest — Raw data normalization and historical backfill orchestrator.
Calls xstockstrat-marketdata to trigger Alpaca backfills.
Publishes normalized events to xstockstrat-ledger.

Ports:
  GRPC_PORT (50055)  — gRPC (HTTP/2), internal service-to-service
  HTTP_PORT (8055)   — Connect-RPC (HTTP/1.1 + HTTP/2), browser + external clients
"""
import asyncio
import logging
import os
import signal

import grpc
import uvicorn
from connectrpc.asgi import ConnectHandler
from grpc_reflection.v1alpha import reflection

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import IngestServicer
from gen.ingest.v1 import ingest_pb2_grpc
from gen.ingest.v1.ingest_pb2 import DESCRIPTOR as INGEST_DESCRIPTOR

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

GRPC_PORT = os.environ.get("GRPC_PORT", "50055")
HTTP_PORT = int(os.environ.get("HTTP_PORT", "8055"))
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")
MARKETDATA_ENDPOINT = os.environ.get("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053")
LEDGER_ENDPOINT = os.environ.get("LEDGER_ENDPOINT", "xstockstrat-ledger:50057")


async def start_connect_server(servicer: IngestServicer) -> None:
    """Start Connect-RPC ASGI server on HTTP_PORT."""
    connect_app = ConnectHandler(
        servicer=servicer,
        service_descriptor=INGEST_DESCRIPTOR.services_by_name["IngestService"],
    )
    config = uvicorn.Config(app=connect_app, host="0.0.0.0", port=HTTP_PORT, loop="asyncio", log_level="info")
    server = uvicorn.Server(config)
    log.info("ingest Connect-RPC HTTP service starting on port %d", HTTP_PORT)
    await server.serve()


async def serve():
    cfg_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="ingest")
    await cfg_watcher.wait_for_snapshot(timeout_seconds=10)
    log.info("config snapshot received")

    marketdata_channel = grpc.aio.insecure_channel(MARKETDATA_ENDPOINT)
    ledger_channel = grpc.aio.insecure_channel(LEDGER_ENDPOINT)

    servicer = IngestServicer(
        config_watcher=cfg_watcher,
        marketdata_channel=marketdata_channel,
        ledger_channel=ledger_channel,
    )

    # ── gRPC server (internal, port 50055) ────────────────────────────────
    grpc_server = grpc.aio.server()
    ingest_pb2_grpc.add_IngestServiceServicer_to_server(servicer, grpc_server)

    service_names = (
        INGEST_DESCRIPTOR.services_by_name["IngestService"].full_name,
        reflection.SERVICE_NAME,
    )
    reflection.enable_server_reflection(service_names, grpc_server)

    grpc_server.add_insecure_port(f"[::]:{GRPC_PORT}")
    log.info("ingest gRPC service starting on port %s", GRPC_PORT)
    await grpc_server.start()

    def handle_shutdown(sig, _):
        asyncio.get_event_loop().create_task(grpc_server.stop(grace=5))

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    await asyncio.gather(
        grpc_server.wait_for_termination(),
        start_connect_server(servicer),
    )


if __name__ == "__main__":
    asyncio.run(serve())
