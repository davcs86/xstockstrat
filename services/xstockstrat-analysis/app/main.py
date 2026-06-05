"""
xstockstrat-analysis — Strategy scoring and backtesting service.

Ports:
  GRPC_PORT (50056)  — gRPC (HTTP/2), internal service-to-service
"""

import asyncio
import logging
import os
import signal

import asyncpg
import grpc
from gen.analysis.v1 import analysis_pb2_grpc
from gen.analysis.v1.analysis_pb2 import DESCRIPTOR as ANALYSIS_DESCRIPTOR
from grpc_reflection.v1alpha import reflection

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import AnalysisServicer
from app.telemetry import init_telemetry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

GRPC_PORT = os.environ.get("GRPC_PORT", "50056")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")
MARKETDATA_ENDPOINT = os.environ.get("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053")
INDICATORS_ENDPOINT = os.environ.get("INDICATORS_ENDPOINT", "xstockstrat-indicators:50054")
INGEST_ENDPOINT = os.environ.get("INGEST_ENDPOINT", "xstockstrat-ingest:50055")
LEDGER_ENDPOINT = os.environ.get("LEDGER_ENDPOINT", "xstockstrat-ledger:50057")
NOTIFY_ENDPOINT = os.environ.get("NOTIFY_ENDPOINT", "xstockstrat-notify:50059")
DATABASE_URL = os.environ.get("DATABASE_URL", "")


async def serve():
    init_telemetry()

    cfg_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="analysis")
    await cfg_watcher.wait_for_snapshot(timeout_seconds=90)
    log.info("config snapshot received")

    db_pool = None
    if DATABASE_URL:
        db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
        log.info("analysis DB pool created")

    servicer = AnalysisServicer(
        config_watcher=cfg_watcher,
        marketdata_channel=grpc.aio.insecure_channel(MARKETDATA_ENDPOINT),
        indicators_channel=grpc.aio.insecure_channel(INDICATORS_ENDPOINT),
        ingest_channel=grpc.aio.insecure_channel(INGEST_ENDPOINT),
        ledger_channel=grpc.aio.insecure_channel(LEDGER_ENDPOINT),
        db_pool=db_pool,
        notify_channel=grpc.aio.insecure_channel(NOTIFY_ENDPOINT),
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

    # ── Live strategy→alert evaluation loop (feature 048) ─────────────────
    if db_pool is not None:
        from app.engine.live_loop import LiveEvaluationLoop
        from app.services.evaluator import StrategyEvaluator

        live_loop = LiveEvaluationLoop(
            config_watcher=cfg_watcher,
            db_pool=db_pool,
            marketdata_stub=servicer._marketdata,
            ingest_stub=servicer._ingest,
            notify_stub=servicer._notify,
            ledger_stub=servicer._ledger,
            evaluator=StrategyEvaluator(servicer._indicators, ()),
        )
        asyncio.get_event_loop().create_task(live_loop.run_forever())
        log.info("live evaluation loop started")

    await grpc_server.wait_for_termination()


if __name__ == "__main__":
    asyncio.run(serve())
