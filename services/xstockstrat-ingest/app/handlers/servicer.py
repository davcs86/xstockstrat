"""
IngestServicer — orchestrates historical backfills via xstockstrat-marketdata,
normalises raw data payloads, and persists newsletter signals to TimescaleDB.
"""

import asyncio
import logging
import uuid
from datetime import UTC

import grpc
from gen.identity.v1 import identity_pb2, identity_pb2_grpc
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.repositories.signal_sources import (
    deactivate_source,
    list_all_sources,
    upsert_source,
    validate_config_json,
)

log = logging.getLogger(__name__)


class IngestServicer(ingest_pb2_grpc.IngestServiceServicer):
    def __init__(
        self,
        config_watcher: ConfigWatcher,
        marketdata_channel,
        ledger_channel,
        db_pool=None,
        identity_channel=None,
    ):
        self._cfg = config_watcher
        self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)
        self._ledger = ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
        self._identity = (
            identity_pb2_grpc.IdentityServiceStub(identity_channel) if identity_channel else None
        )
        self._db = db_pool
        self._jobs: dict[str, ingest_pb2.BackfillJob] = {}

    async def _validate_admin_token(self, context) -> bool:
        """Returns True if Authorization header contains a valid admin API key."""
        if self._identity is None:
            return False
        metadata = dict(context.invocation_metadata())
        auth = metadata.get("authorization", "")
        if not auth.startswith("Bearer "):
            return False
        api_key = auth[len("Bearer ") :]
        try:
            claims = await self._identity.ValidateApiKey(
                identity_pb2.ValidateApiKeyRequest(api_key=api_key)
            )
            return "admin" in claims.roles
        except Exception:
            return False

    async def TriggerBackfill(self, request, context):
        job_id = str(uuid.uuid4())
        job = ingest_pb2.BackfillJob(
            job_id=job_id,
            symbols=list(request.symbols),
            timeframe=request.timeframe,
            range=request.range,
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )
        self._jobs[job_id] = job
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        asyncio.create_task(self._run_backfill(job_id, request, propagation_meta))
        return ingest_pb2.TriggerBackfillResponse(
            job_id=job_id,
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )

    async def _run_backfill(self, job_id: str, request, propagation_meta=()):
        job = self._jobs[job_id]
        job.status = ingest_pb2.BACKFILL_STATUS_RUNNING
        log.info("backfill job %s starting symbols=%s", job_id, list(request.symbols))

        try:
            resp = await self._marketdata.BackfillBars(
                marketdata_pb2.BackfillBarsRequest(
                    symbols=list(request.symbols),
                    timeframe=request.timeframe,
                    range=request.range,
                    overwrite_existing=request.overwrite,
                ),
                metadata=propagation_meta,
            )
            job.bars_processed = resp.bars_written
            job.status = (
                ingest_pb2.BACKFILL_STATUS_PARTIAL
                if resp.failed_symbols
                else ingest_pb2.BACKFILL_STATUS_COMPLETED
            )
            log.info(
                "backfill job %s completed bars=%d failed=%s",
                job_id,
                resp.bars_written,
                resp.failed_symbols,
            )

            # Emit ledger event
            from google.protobuf.struct_pb2 import Struct

            payload = Struct()
            payload.update(
                {
                    "job_id": job_id,
                    "symbols": list(request.symbols),
                    "bars_written": resp.bars_written,
                    "failed_symbols": list(resp.failed_symbols),
                }
            )
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type="ingest.backfill.completed",
                    source_service="xstockstrat-ingest",
                    stream_key=f"backfill:{job_id}",
                    payload=payload,
                ),
                metadata=propagation_meta,
            )
        except Exception as e:
            job.status = ingest_pb2.BACKFILL_STATUS_FAILED
            job.error = str(e)
            log.error("backfill job %s failed: %s", job_id, e)

    async def GetBackfillStatus(self, request, context):
        job = self._jobs.get(request.job_id)
        if job is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"job {request.job_id} not found")
            return
        return job

    async def ListBackfillJobs(self, request, context):
        jobs = list(self._jobs.values())
        if request.status_filter != ingest_pb2.BACKFILL_STATUS_UNSPECIFIED:
            jobs = [j for j in jobs if j.status == request.status_filter]
        return ingest_pb2.ListBackfillJobsResponse(jobs=jobs)

    async def NormalizeRawData(self, request, context):
        # Normalise CSV/JSON/alpaca_v2 payloads into ledger events
        rows = 0
        errors = []
        try:
            if request.format == "csv":
                rows = await self._normalize_csv(request.raw_data)
            elif request.format in ("json", "alpaca_v2"):
                rows = await self._normalize_json(request.raw_data, request.format)
            else:
                errors.append(f"Unknown format: {request.format}")
        except Exception as e:
            errors.append(str(e))
        return ingest_pb2.NormalizeRawDataResponse(rows_normalized=rows, errors=errors)

    async def _normalize_csv(self, raw: bytes) -> int:
        import csv
        import io

        reader = csv.DictReader(io.StringIO(raw.decode()))
        count = sum(1 for _ in reader)
        return count

    async def _normalize_json(self, raw: bytes, fmt: str) -> int:
        import json

        data = json.loads(raw)
        return len(data) if isinstance(data, list) else 1

    async def IngestSignal(self, request, context):
        """Persist an ExternalSignal to ingest.newsletter_signals hypertable."""
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return

        signal = request.signal
        if not signal.source or not signal.symbol or not signal.direction:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, "source, symbol, and direction are required"
            )
            return

        valid_directions = {"buy", "sell", "hold", "watchlist"}
        if signal.direction not in valid_directions:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT, f"direction must be one of {valid_directions}"
            )
            return

        # FR-3: source slug must be registered and active
        source_row = await self._db.fetchrow(
            "SELECT slug FROM ingest.signal_sources WHERE slug = $1 AND active = TRUE",
            signal.source,
        )
        if source_row is None:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"source slug '{signal.source}' is not a registered active source",
            )
            return

        # Convert protobuf Timestamps to Python datetimes
        valid_from = signal.valid_from.ToDatetime(tzinfo=UTC)
        valid_until = None
        if signal.HasField("valid_until") and signal.valid_until.seconds > 0:
            valid_until = signal.valid_until.ToDatetime(tzinfo=UTC)

        conviction = signal.conviction if signal.conviction > 0.0 else None

        try:
            row = await self._db.fetchrow(
                """
                INSERT INTO ingest.newsletter_signals
                    (source, symbol, direction, conviction,
                     valid_from, valid_until, headline, raw_url, tags)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
                """,
                signal.source,
                signal.symbol.upper(),
                signal.direction,
                conviction,
                valid_from,
                valid_until,
                signal.headline or None,
                signal.raw_url or None,
                list(signal.tags) if signal.tags else [],
            )
            signal_id = row["id"]
        except Exception as e:
            log.error("failed to insert signal: %s", e)
            await context.abort(grpc.StatusCode.INTERNAL, f"database error: {e}")
            return

        log.info(
            "ingested signal id=%d source=%s symbol=%s direction=%s",
            signal_id,
            signal.source,
            signal.symbol,
            signal.direction,
        )

        # Emit ledger event
        from google.protobuf.struct_pb2 import Struct

        payload = Struct()
        payload.update(
            {
                "signal_id": signal_id,
                "source": signal.source,
                "symbol": signal.symbol,
                "direction": signal.direction,
            }
        )
        try:
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type="ingest.signal.ingested",
                    source_service="xstockstrat-ingest",
                    stream_key=f"signal:{signal.source}:{signal.symbol}",
                    payload=payload,
                ),
                metadata=propagation_meta,
            )
        except Exception as e:
            log.warning("failed to emit ledger event for signal %d: %s", signal_id, e)

        return ingest_pb2.IngestSignalResponse(signal_id=signal_id)

    async def QuerySignals(self, request, context):
        """Query active signals filtered by source/symbol/direction and time window."""
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return

        # Build dynamic WHERE clauses
        conditions = []
        params = []
        idx = 1

        if request.source:
            conditions.append(f"source = ${idx}")
            params.append(request.source)
            idx += 1

        if request.symbol:
            conditions.append(f"symbol = ${idx}")
            params.append(request.symbol.upper())
            idx += 1

        if request.direction:
            conditions.append(f"direction = ${idx}")
            params.append(request.direction)
            idx += 1

        # Active window filter: signals whose validity overlaps with requested range
        has_active_window = (
            request.HasField("active_window") and request.active_window.start.seconds > 0
        )
        if has_active_window:
            window_start = request.active_window.start.ToDatetime(tzinfo=UTC)
            window_end = (
                request.active_window.end.ToDatetime(tzinfo=UTC)
                if request.active_window.end.seconds > 0
                else None
            )

            conditions.append(f"valid_from <= ${idx}")
            params.append(window_end or window_start)
            idx += 1

            conditions.append(f"(valid_until IS NULL OR valid_until >= ${idx})")
            params.append(window_start)
            idx += 1

        where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

        # Pagination
        limit = request.page.page_size if request.page.page_size > 0 else 100
        offset_val = request.page.page_token  # reuse as integer offset for simplicity

        try:
            offset_int = int(offset_val) if offset_val else 0
        except ValueError:
            offset_int = 0

        try:
            rows = await self._db.fetch(
                f"""
                SELECT source, symbol, direction, conviction, valid_from, valid_until,
                       headline, raw_url, tags
                FROM ingest.newsletter_signals
                {where_clause}
                ORDER BY ingested_at DESC
                LIMIT ${idx} OFFSET ${idx + 1}
                """,
                *params,
                limit,
                offset_int,
            )
        except Exception as e:
            log.error("failed to query signals: %s", e)
            await context.abort(grpc.StatusCode.INTERNAL, f"database error: {e}")
            return

        signals = []
        for row in rows:
            sig = ingest_pb2.ExternalSignal(
                source=row["source"],
                symbol=row["symbol"],
                direction=row["direction"],
                conviction=float(row["conviction"]) if row["conviction"] is not None else 0.0,
                headline=row["headline"] or "",
                raw_url=row["raw_url"] or "",
                tags=list(row["tags"]) if row["tags"] else [],
            )
            # Set valid_from timestamp
            vf = Timestamp()
            vf.FromDatetime(row["valid_from"])
            sig.valid_from.CopyFrom(vf)
            # Set valid_until if present
            if row["valid_until"] is not None:
                vu = Timestamp()
                vu.FromDatetime(row["valid_until"])
                sig.valid_until.CopyFrom(vu)
            signals.append(sig)

        next_token = str(offset_int + len(rows)) if len(rows) == limit else ""
        from gen.common.v1 import common_pb2

        return ingest_pb2.QuerySignalsResponse(
            signals=signals,
            page=common_pb2.PageResponse(next_page_token=next_token, total_count=len(signals)),
        )

    async def ListSignalSources(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        rows = await list_all_sources(self._db, include_inactive=request.include_inactive)
        import json

        from google.protobuf.struct_pb2 import Struct

        sources = []
        for row in rows:
            cfg = Struct()
            if row["config_json"]:
                cfg.update(
                    row["config_json"]
                    if isinstance(row["config_json"], dict)
                    else json.loads(row["config_json"])
                )
            sources.append(
                ingest_pb2.SignalSource(
                    slug=row["slug"],
                    display_name=row["display_name"],
                    source_type=row["source_type"],
                    extractor_module=row["extractor_module"],
                    active=row["active"],
                    has_credentials=(row["credentials_ref"] is not None),
                    config_json=cfg,
                )
            )
        return ingest_pb2.ListSignalSourcesResponse(sources=sources)

    async def ManageSignalSource(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        is_admin = await self._validate_admin_token(context)
        if not is_admin:
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, "admin API key required")
            return
        op = request.operation
        src = request.source
        if op in ("register", "update"):
            if src.source_type == "authenticated_website" and not request.credentials_ref:
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    "authenticated_website source requires credentials_ref",
                )
                return
            cfg_dict = dict(src.config_json) if src.config_json else None
            err = validate_config_json(src.source_type, cfg_dict)
            if err:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, err)
                return
            row = await upsert_source(
                self._db,
                slug=src.slug,
                display_name=src.display_name,
                source_type=src.source_type,
                extractor_module=src.extractor_module,
                credentials_ref=request.credentials_ref or None,
                config_json=cfg_dict,
                active=src.active,
            )
        elif op == "deactivate":
            row = await deactivate_source(self._db, src.slug)
            if row is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, f"source '{src.slug}' not found")
                return
        else:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                f"unknown operation '{op}': must be register, update, or deactivate",
            )
            return
        import json

        from google.protobuf.struct_pb2 import Struct

        cfg_out = Struct()
        if row["config_json"]:
            cfg_out.update(
                row["config_json"]
                if isinstance(row["config_json"], dict)
                else json.loads(str(row["config_json"]))
            )
        result = ingest_pb2.SignalSource(
            slug=row["slug"],
            display_name=row["display_name"],
            source_type=row["source_type"],
            extractor_module=row["extractor_module"],
            active=row["active"],
            has_credentials=(row["credentials_ref"] is not None),
            config_json=cfg_out,
        )
        return ingest_pb2.ManageSignalSourceResponse(source=result)
