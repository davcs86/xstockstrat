"""
xstockstrat-ingest — Raw data normalization and historical backfill orchestrator.
Calls xstockstrat-marketdata to trigger Alpaca backfills.
Publishes normalized events to xstockstrat-ledger.
Persists newsletter signals to TimescaleDB (ingest.newsletter_signals hypertable).

Ports:
  GRPC_PORT (50055)  — gRPC (HTTP/2), internal service-to-service
"""

import asyncio
import logging
import os
import signal
import ssl as _ssl

import asyncpg
import grpc
from gen.ingest.v1 import ingest_pb2_grpc
from gen.ingest.v1.ingest_pb2 import DESCRIPTOR as INGEST_DESCRIPTOR
from grpc_reflection.v1alpha import reflection

from app.config.watcher import ConfigWatcher
from app.handlers.servicer import IngestServicer
from app.telemetry import init_telemetry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

GRPC_PORT = os.environ.get("GRPC_PORT", "50055")
CONFIG_ENDPOINT = os.environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060")
MARKETDATA_ENDPOINT = os.environ.get("MARKETDATA_ENDPOINT", "xstockstrat-marketdata:50053")
LEDGER_ENDPOINT = os.environ.get("LEDGER_ENDPOINT", "xstockstrat-ledger:50057")
NOTIFY_ENDPOINT = os.environ.get("NOTIFY_ENDPOINT", "xstockstrat-notify:50059")
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is required but not set. See .env.example."
    )


async def serve():
    init_telemetry()

    cfg_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="ingest")
    await cfg_watcher.wait_for_snapshot(timeout_seconds=90)
    log.info("config snapshot received")

    # Open asyncpg connection pool for signal persistence
    _ssl_ctx: _ssl.SSLContext | None = None
    if "sslmode=disable" not in DATABASE_URL:
        _ssl_ctx = _ssl.create_default_context()
        _ssl_ctx.check_hostname = False
        _ssl_ctx.verify_mode = _ssl.CERT_NONE
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10, ssl=_ssl_ctx)
    log.info("database pool established")

    # FR-3: reconcile backfill jobs left RUNNING/QUEUED by a previous process. Enum ints are
    # passed in so the repository stays proto-free. No automatic resume (P0 scope).
    from gen.ingest.v1 import ingest_pb2

    from app.repositories import backfill_jobs

    reconciled = await backfill_jobs.reconcile_interrupted(
        db_pool,
        failed_status=ingest_pb2.BACKFILL_STATUS_FAILED,
        running_status=ingest_pb2.BACKFILL_STATUS_RUNNING,
        queued_status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        error_msg="interrupted by restart",
    )
    log.info("reconciled %d interrupted backfill job(s)", reconciled)

    marketdata_channel = grpc.aio.insecure_channel(MARKETDATA_ENDPOINT)
    ledger_channel = grpc.aio.insecure_channel(LEDGER_ENDPOINT)
    notify_channel = grpc.aio.insecure_channel(NOTIFY_ENDPOINT)

    servicer = IngestServicer(
        config_watcher=cfg_watcher,
        marketdata_channel=marketdata_channel,
        ledger_channel=ledger_channel,
        db_pool=db_pool,
        notify_channel=notify_channel,
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
        async def _stop():
            await grpc_server.stop(grace=5)
            await db_pool.close()

        asyncio.get_event_loop().create_task(_stop())

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    await grpc_server.wait_for_termination()


if __name__ == "__main__":
    asyncio.run(serve())
