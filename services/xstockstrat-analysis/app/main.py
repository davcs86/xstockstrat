"""
xstockstrat-analysis — Strategy scoring and backtesting service.
"""
import asyncio
import logging
import os
import signal

import grpc
from grpc_reflection.v1alpha import reflection

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer
from gen.analysis.v1 import analysis_pb2_grpc
from gen.analysis.v1.analysis_pb2 import DESCRIPTOR as ANALYSIS_DESCRIPTOR

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

GRPC_PORT = os.environ.get("GRPC_PORT", "50056")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")
MARKETDATA_ENDPOINT = os.environ.get("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053")
INDICATORS_ENDPOINT = os.environ.get("INDICATORS_ENDPOINT", "xstockstrat-indicators:50054")
LEDGER_ENDPOINT = os.environ.get("LEDGER_ENDPOINT", "xstockstrat-ledger:50057")


async def serve():
    cfg_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="analysis")
    await cfg_watcher.wait_for_snapshot(timeout_seconds=10)
    log.info("config snapshot received")

    server = grpc.aio.server()
    servicer = AnalysisServicer(
        config_watcher=cfg_watcher,
        marketdata_channel=grpc.aio.insecure_channel(MARKETDATA_ENDPOINT),
        indicators_channel=grpc.aio.insecure_channel(INDICATORS_ENDPOINT),
        ledger_channel=grpc.aio.insecure_channel(LEDGER_ENDPOINT),
    )
    analysis_pb2_grpc.add_AnalysisServiceServicer_to_server(servicer, server)

    service_names = (
        ANALYSIS_DESCRIPTOR.services_by_name["AnalysisService"].full_name,
        reflection.SERVICE_NAME,
    )
    reflection.enable_server_reflection(service_names, server)

    server.add_insecure_port(f"[::]:{GRPC_PORT}")
    log.info("analysis service starting on port %s", GRPC_PORT)
    await server.start()

    def handle_shutdown(sig, _):
        asyncio.get_event_loop().create_task(server.stop(grace=5))

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)
    await server.wait_for_termination()


if __name__ == "__main__":
    asyncio.run(serve())
