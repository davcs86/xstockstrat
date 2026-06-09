"""
IngestServicer — orchestrates historical backfills via xstockstrat-marketdata,
normalises raw data payloads, and persists newsletter signals to TimescaleDB.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

import grpc
from gen.common.v1 import common_pb2
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from gen.notify.v1 import notify_pb2, notify_pb2_grpc
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.repositories import backfill_jobs
from app.repositories.signal_sources import (
    deactivate_source,
    list_all_sources,
    upsert_source,
    validate_config_json,
)

log = logging.getLogger(__name__)


def _ts_to_dt(ts) -> datetime | None:
    """Convert a protobuf Timestamp to an aware datetime, or None if unset."""
    if ts is None or ts.seconds == 0:
        return None
    return ts.ToDatetime(tzinfo=UTC)


def _dt_to_ts(dt: datetime) -> Timestamp:
    ts = Timestamp()
    ts.FromDatetime(dt)
    return ts


def job_row_to_proto(row: dict) -> ingest_pb2.BackfillJob:
    """Map an ``ingest.backfill_jobs`` row to a BackfillJob message."""
    job = ingest_pb2.BackfillJob(
        job_id=str(row["job_id"]),
        symbols=list(row["symbols"] or []),
        timeframe=row["timeframe"] or "",
        status=row["status"],
        bars_processed=row["bars_processed"] or 0,
        bars_total=row["bars_total"] or 0,
        failed_symbols=list(row["failed_symbols"] or []),
        error=row["error"] or "",
    )
    if row.get("range_start") or row.get("range_end"):
        tr = common_pb2.TimeRange()
        if row.get("range_start"):
            tr.start.CopyFrom(_dt_to_ts(row["range_start"]))
        if row.get("range_end"):
            tr.end.CopyFrom(_dt_to_ts(row["range_end"]))
        job.range.CopyFrom(tr)
    if row.get("started_at"):
        job.started_at.CopyFrom(_dt_to_ts(row["started_at"]))
    if row.get("completed_at"):
        job.completed_at.CopyFrom(_dt_to_ts(row["completed_at"]))
    return job


class IngestServicer(ingest_pb2_grpc.IngestServiceServicer):
    def __init__(
        self,
        config_watcher: ConfigWatcher,
        marketdata_channel,
        ledger_channel,
        db_pool=None,
        notify_channel=None,
    ):
        self._cfg = config_watcher
        self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)
        self._ledger = ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
        self._notify = notify_pb2_grpc.NotifyServiceStub(notify_channel) if notify_channel else None
        self._db = db_pool
        # Concurrency gate (FR-9): read once at init. Jobs above the limit stay QUEUED in
        # the table until the semaphore is acquired. Live re-read of the key is out of scope.
        self._backfill_sem = asyncio.Semaphore(self._cfg.backfill_max_concurrent_jobs)

    @staticmethod
    def _has_admin_scope(context) -> bool:
        """Role check on the propagated x-access-scope ADMIN bit (0x04).

        Internal services trust the access scope set by the entry points (UI BFF via JWT,
        MCP agent via its SSE auth layer) and do a role check at most — they do not
        re-authenticate. Mirrors the analysis servicer's gate (feature 049 Part A).
        """
        metadata = dict(context.invocation_metadata())
        try:
            access_scope = int(metadata.get("x-access-scope", "0"))
        except (TypeError, ValueError):
            access_scope = 0
        return bool(access_scope & 0x04)

    @staticmethod
    def _propagation_meta(context):
        return [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]

    async def TriggerBackfill(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        job_id = str(uuid.uuid4())
        propagation_meta = self._propagation_meta(context)
        await backfill_jobs.insert_job(
            self._db,
            job_id=job_id,
            symbols=list(request.symbols),
            timeframe=request.timeframe,
            range_start=_ts_to_dt(request.range.start),
            range_end=_ts_to_dt(request.range.end),
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )
        await self._emit_backfill_event(
            "ingest.backfill.queued",
            job_id,
            {"symbols": list(request.symbols), "timeframe": request.timeframe},
            propagation_meta,
        )
        asyncio.create_task(self._run_backfill(job_id, request, propagation_meta))
        return ingest_pb2.TriggerBackfillResponse(
            job_id=job_id,
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
        )

    async def _emit_backfill_event(self, event_type, job_id, payload_dict, propagation_meta):
        """Emit a backfill lifecycle event to the ledger. Ledger errors are non-fatal."""
        payload = Struct()
        payload.update({"job_id": job_id, **payload_dict})
        try:
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type=event_type,
                    source_service="xstockstrat-ingest",
                    stream_key=f"backfill:{job_id}",
                    payload=payload,
                ),
                metadata=propagation_meta,
            )
        except Exception as e:
            log.warning("failed to emit %s for job %s: %s", event_type, job_id, e)

    async def _emit_backfill_alert(self, job_id, status, failed_symbols, error, propagation_meta):
        """Emit a notify alert on FAILED (ERROR) or PARTIAL (WARNING). Guarded + non-fatal."""
        if self._notify is None:
            return
        is_failed = status == ingest_pb2.BACKFILL_STATUS_FAILED
        label = "failed" if is_failed else "partial"
        severity = (
            notify_pb2.ALERT_SEVERITY_ERROR if is_failed else notify_pb2.ALERT_SEVERITY_WARNING
        )
        ctx = Struct()
        ctx.update({"job_id": job_id, "failed_symbols": list(failed_symbols), "error": error or ""})
        try:
            await self._notify.EmitAlert(
                notify_pb2.EmitAlertRequest(
                    severity=severity,
                    category="backfill",
                    title=f"Backfill {job_id} {label}",
                    body=f"Backfill job {job_id} {label}: {error}",
                    source_service="xstockstrat-ingest",
                    tags=[f"job_id:{job_id}"],
                    context=ctx,
                ),
                metadata=propagation_meta,
            )
        except Exception as e:
            log.warning("failed to emit alert for job %s: %s", job_id, e)

    async def _run_backfill(self, job_id: str, request, propagation_meta=()):
        symbols = list(request.symbols)
        try:
            # Concurrency gate: a job above max_concurrent_jobs blocks here, staying QUEUED
            # in the table until the semaphore is free, then transitions to RUNNING.
            async with self._backfill_sem:
                await backfill_jobs.update_job(
                    self._db,
                    job_id,
                    status=ingest_pb2.BACKFILL_STATUS_RUNNING,
                    started_at=datetime.now(UTC),
                )
                await self._emit_backfill_event(
                    "ingest.backfill.running", job_id, {"symbols": symbols}, propagation_meta
                )
                log.info("backfill job %s running symbols=%s", job_id, symbols)
                await self._execute_backfill(job_id, request, symbols, propagation_meta)
        except Exception as e:
            # Total failure (e.g. marketdata RPC error) → FAILED + failed event + alert.
            log.error("backfill job %s failed: %s", job_id, e)
            await backfill_jobs.update_job(
                self._db,
                job_id,
                status=ingest_pb2.BACKFILL_STATUS_FAILED,
                error=str(e),
                completed_at=datetime.now(UTC),
            )
            await self._emit_backfill_event(
                "ingest.backfill.failed", job_id, {"error": str(e)}, propagation_meta
            )
            await self._emit_backfill_alert(
                job_id, ingest_pb2.BACKFILL_STATUS_FAILED, symbols, str(e), propagation_meta
            )

    async def _execute_backfill(self, job_id, request, symbols, propagation_meta):
        """Run the marketdata backfill with retry-on-transient-failure (FR-8).

        Retries only the still-failing symbols with 2s/4s/8s backoff up to
        ``max_retry_attempts`` when ``retry_on_failure`` is enabled. A non-empty
        ``failed_symbols`` after retries is a PARTIAL outcome; a raised exception
        propagates to ``_run_backfill`` as a total FAILED.
        """
        remaining = list(symbols)
        total_bars = 0
        expected_bars = 0
        failed: list[str] = []
        max_attempts = (
            self._cfg.backfill_max_retry_attempts if self._cfg.backfill_retry_on_failure else 0
        )
        attempt = 0
        while True:
            resp = await self._marketdata.BackfillBars(
                marketdata_pb2.BackfillBarsRequest(
                    symbols=remaining,
                    timeframe=request.timeframe,
                    range=request.range,
                    overwrite_existing=request.overwrite,
                ),
                metadata=propagation_meta,
            )
            total_bars += resp.bars_written
            if resp.expected_bars:
                expected_bars = resp.expected_bars
            failed = list(resp.failed_symbols)
            await backfill_jobs.update_job(
                self._db,
                job_id,
                bars_processed=total_bars,
                bars_total=expected_bars,
                failed_symbols=failed,
            )
            if not failed or attempt >= max_attempts:
                break
            attempt += 1
            await asyncio.sleep(2**attempt)  # 2s, 4s, 8s
            remaining = failed

        now = datetime.now(UTC)
        if failed:
            # PARTIAL: some symbols failed — emit `completed` (with failed_symbols), NOT `failed`.
            await backfill_jobs.update_job(
                self._db,
                job_id,
                status=ingest_pb2.BACKFILL_STATUS_PARTIAL,
                failed_symbols=failed,
                bars_processed=total_bars,
                bars_total=expected_bars,
                completed_at=now,
            )
            await self._emit_backfill_event(
                "ingest.backfill.completed",
                job_id,
                {"bars_written": total_bars, "failed_symbols": failed},
                propagation_meta,
            )
            await self._emit_backfill_alert(
                job_id,
                ingest_pb2.BACKFILL_STATUS_PARTIAL,
                failed,
                "some symbols failed to backfill",
                propagation_meta,
            )
            log.info("backfill job %s partial bars=%d failed=%s", job_id, total_bars, failed)
        else:
            await backfill_jobs.update_job(
                self._db,
                job_id,
                status=ingest_pb2.BACKFILL_STATUS_COMPLETED,
                failed_symbols=[],
                bars_processed=total_bars,
                bars_total=expected_bars,
                completed_at=now,
            )
            await self._emit_backfill_event(
                "ingest.backfill.completed",
                job_id,
                {"bars_written": total_bars, "failed_symbols": []},
                propagation_meta,
            )
            log.info("backfill job %s completed bars=%d", job_id, total_bars)

    async def GetBackfillStatus(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        row = await backfill_jobs.get_job(self._db, request.job_id)
        if row is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"job {request.job_id} not found")
            return
        return job_row_to_proto(row)

    async def ListBackfillJobs(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        status_filter = (
            request.status_filter
            if request.status_filter != ingest_pb2.BACKFILL_STATUS_UNSPECIFIED
            else None
        )
        limit = request.page.page_size if request.page.page_size > 0 else 100
        try:
            offset = int(request.page.page_token) if request.page.page_token else 0
        except ValueError:
            offset = 0
        rows = await backfill_jobs.list_jobs(
            self._db, status_filter=status_filter, limit=limit, offset=offset
        )
        next_token = str(offset + len(rows)) if len(rows) == limit else ""
        return ingest_pb2.ListBackfillJobsResponse(
            jobs=[job_row_to_proto(r) for r in rows],
            page=common_pb2.PageResponse(next_page_token=next_token, total_count=len(rows)),
        )

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
        if not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
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
