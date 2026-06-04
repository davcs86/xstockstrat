"""
xstockstrat-indicators — gRPC server entry point.

Formula engine + sandboxed Python execution.
Timeout and memory cap sourced from xstockstrat-config at startup.

Ports:
  GRPC_PORT (50054)  — gRPC (HTTP/2), internal service-to-service
"""

import asyncio
import logging
import os
import signal

import asyncpg
import grpc
from gen.indicators.v1 import indicators_pb2_grpc
from gen.indicators.v1.indicators_pb2 import DESCRIPTOR as INDICATORS_DESCRIPTOR
from grpc_reflection.v1alpha import reflection

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import IndicatorsServicer
from app.telemetry import init_telemetry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger(__name__)

GRPC_PORT = os.environ.get("GRPC_PORT", "50054")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgres://xstockstrat:devpassword@localhost:5432/xstockstrat"
)


async def serve():
    init_telemetry()

    # Subscribe to config before accepting traffic
    log.info("connecting to config service at %s", CONFIG_ENDPOINT)
    config_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="indicators")
    await config_watcher.wait_for_snapshot(timeout_seconds=90)
    log.info("config snapshot received")

    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    log.info("database pool established")

    servicer = IndicatorsServicer(config_watcher=config_watcher, db_pool=db_pool)

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
        asyncio.get_event_loop().create_task(db_pool.close())

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    await grpc_server.wait_for_termination()


if __name__ == "__main__":
    asyncio.run(serve())
