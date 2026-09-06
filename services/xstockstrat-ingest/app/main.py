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

    _ssl_ctx: _ssl.SSLContext | None = None
    if "sslmode=disable" not in DATABASE_URL:
        _ssl_ctx = _ssl.create_default_context()
        _ssl_ctx.check_hostname = False
        _ssl_ctx.verify_mode = _ssl.CERT_NONE
    db_pool = await asyncpg.create_pool(
        DATABASE_URL,
        min_size=1,
        max_size=int(os.environ.get("DB_POOL_MAX", "2")),
        ssl=_ssl_ctx,
        # PgBouncer transaction mode needs the prepared-statement cache off (0): consecutive
        # queries can land on different backend connections; direct path keeps the default.
        statement_cache_size=0 if os.environ.get("DB_PGBOUNCER") in ("true", "1") else 100,
    )
    log.info("database pool established")

    # Reconcile jobs left RUNNING/QUEUED by a prior process to FAILED; no automatic resume.
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

    # Resume jobs with incomplete chunks; must run after the reconcile pass, which only
    # flips chunk-less jobs to FAILED and leaves chunked ones for this to re-drive.
    resumed = await servicer.resume_incomplete_jobs()
    log.info("resumed %d backfill job(s) with incomplete chunks", resumed)

    # Non-fatal: a failure to start the mcp_client query loop must never take down the service.
    try:
        from app.engine.mcp_client_loop import run_mcp_client_loop
        from app.mcp_client import StreamableHttpMcpClient

        asyncio.create_task(run_mcp_client_loop(servicer, cfg_watcher, StreamableHttpMcpClient()))
        log.info("started mcp_client query loop")
    except Exception as e:
        log.warning("failed to start mcp_client query loop: %s", e)

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
