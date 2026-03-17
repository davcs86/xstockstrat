"""
xstockstrat-indicators — gRPC server entry point.

Formula engine + sandboxed Python execution.
Timeout and memory cap sourced from xstockstrat-config at startup.
"""
import asyncio
import logging
import os
import signal
import sys

import grpc
from grpc_reflection.v1alpha import reflection

from app.config.watcher import ConfigWatcher
from app.grpc.servicer import IndicatorsServicer
from gen.indicators.v1 import indicators_pb2_grpc
from gen.indicators.v1.indicators_pb2 import DESCRIPTOR as INDICATORS_DESCRIPTOR

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger(__name__)

GRPC_PORT = os.environ.get("GRPC_PORT", "50054")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")


async def serve():
    # Subscribe to config before accepting traffic
    log.info("connecting to config service at %s", CONFIG_ENDPOINT)
    config_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="indicators")
    await config_watcher.wait_for_snapshot(timeout_seconds=10)
    log.info("config snapshot received")

    server = grpc.aio.server()
    servicer = IndicatorsServicer(config_watcher=config_watcher)
    indicators_pb2_grpc.add_IndicatorsServiceServicer_to_server(servicer, server)

    # gRPC reflection for development tooling
    service_names = (
        INDICATORS_DESCRIPTOR.services_by_name["IndicatorsService"].full_name,
        reflection.SERVICE_NAME,
    )
    reflection.enable_server_reflection(service_names, server)

    listen_addr = f"[::]:{GRPC_PORT}"
    server.add_insecure_port(listen_addr)

    log.info("indicators service starting on %s", listen_addr)
    await server.start()

    def handle_shutdown(sig, frame):
        log.info("received signal %s, shutting down", sig)
        asyncio.get_event_loop().create_task(server.stop(grace=5))

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    await server.wait_for_termination()


if __name__ == "__main__":
    asyncio.run(serve())
