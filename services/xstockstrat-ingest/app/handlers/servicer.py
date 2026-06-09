"""
IngestServicer — orchestrates historical backfills via xstockstrat-marketdata,
normalises raw data payloads, and persists newsletter signals to TimescaleDB.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

import grpc
from gen.common.v1 import common_pb2
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from gen.notify.v1 import notify_pb2, notify_pb2_grpc
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.repositories import backfill_chunks, backfill_jobs
from app.repositories.signal_sources import (
    deactivate_source,
    list_all_sources,
    upsert_source,
    validate_config_json,
)

log = logging.getLogger(__name__)

# Canonical timeframe <-> Timeframe enum int (mirrors marketdata internal/timeframe + 053).
_STR_TO_ENUM = {"1m": 1, "5m": 2, "1h": 3, "1d": 4}
_ENUM_TO_STR = {v: k for k, v in _STR_TO_ENUM.items()}
_TF_ALIASES = {
    "1m": "1m",
    "1Min": "1m",
    "5m": "5m",
    "5Min": "5m",
    "1h": "1h",
    "1Hour": "1h",
    "1d": "1d",
    "1Day": "1d",
}


def _canonical_timeframe(request) -> str:
    """Resolve a request's timeframe to the canonical DB string (enum preferred, else string)."""
    enum = getattr(request, "timeframe_enum", 0)
    if isinstance(enum, int) and enum in _ENUM_TO_STR:
        return _ENUM_TO_STR[enum]
    return _TF_ALIASES.get(
        getattr(request, "timeframe", ""), getattr(request, "timeframe", "") or "1d"
    )


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

    async def _plan_work_ranges(self, request, symbols, timeframe, propagation_meta):
        """Return a list of plan_chunks() inputs as (symbols, start, end) work units.

        FULL mode → one unit over the whole requested range. GAPS_ONLY (FR-4) → per-symbol
        units, one per gap reported by marketdata's GetDataCoverage; symbols already fully
        covered contribute nothing.
        """
        range_end = _ts_to_dt(request.range.end) or datetime.now(UTC)
        range_start = _ts_to_dt(request.range.start) or (range_end - timedelta(days=365))
        tf_enum = _STR_TO_ENUM.get(timeframe, 0)

        if getattr(request, "fill_mode", 0) == ingest_pb2.FILL_MODE_GAPS_ONLY:
            units = []
            for sym in symbols:
                cov = await self._marketdata.GetDataCoverage(
                    marketdata_pb2.GetDataCoverageRequest(
                        symbol=sym, timeframe=tf_enum, range=request.range
                    ),
                    metadata=propagation_meta,
                )
                for gap in cov.gaps:
                    gs = _ts_to_dt(gap.start) or range_start
                    ge = _ts_to_dt(gap.end) or range_end
                    units.append(([sym], gs, ge))
            return units
        return [(list(symbols), range_start, range_end)]

    async def _execute_backfill(self, job_id, request, symbols, propagation_meta):
        """Plan the job into chunks, persist them, and execute (resumable, FR-1/FR-4/FR-5).

        Chunk planning is density-aware (chunk_window_days × chunk_max_bars). Chunks run
        concurrently under a chunk-level semaphore, each with per-symbol retry (FR-8). A chunk
        that returns is COMPLETED (its unresolved ``failed_symbols`` accumulate to the job); a
        chunk whose RPC keeps raising is FAILED. Final job status: COMPLETED (clean), PARTIAL
        (some symbols/chunks failed but progress made), or FAILED (no chunk made progress).
        """
        timeframe = _canonical_timeframe(request)
        window_days = self._cfg.backfill_chunk_window_days
        max_bars = self._cfg.backfill_chunk_max_bars

        units = await self._plan_work_ranges(request, symbols, timeframe, propagation_meta)
        planned: list[dict] = []
        for unit_symbols, start, end in units:
            planned += backfill_chunks.plan_chunks(
                unit_symbols, timeframe, start, end, window_days, max_bars
            )

        now = datetime.now(UTC)
        if not planned:
            # e.g. GAPS_ONLY with full coverage → nothing to fetch.
            await backfill_jobs.update_job(
                self._db,
                job_id,
                status=ingest_pb2.BACKFILL_STATUS_COMPLETED,
                chunks_total=0,
                chunks_completed=0,
                completed_at=now,
            )
            await self._emit_backfill_event(
                "ingest.backfill.completed",
                job_id,
                {"bars_written": 0, "failed_symbols": [], "chunks_total": 0},
                propagation_meta,
            )
            log.info("backfill job %s completed with no chunks (nothing to fetch)", job_id)
            return

        await backfill_chunks.insert_chunks(self._db, job_id, planned)
        await backfill_jobs.update_job(
            self._db,
            job_id,
            chunks_total=len(planned),
            bars_total=backfill_chunks.estimate_bars(planned, timeframe),
        )
        log.info("backfill job %s planned %d chunk(s)", job_id, len(planned))

        chunks = await backfill_chunks.get_incomplete_chunks(self._db, job_id)
        state = await self._run_chunks(job_id, request, timeframe, chunks, propagation_meta)
        await self._finalize_backfill(job_id, state, len(planned), propagation_meta)

    async def _finalize_backfill(self, job_id, state, total_chunks, propagation_meta):
        """Set terminal job status from chunk outcomes and emit the completed/failed event+alert.

        Shared by a fresh run and resume-on-startup. COMPLETED (clean) / PARTIAL (progress made
        but some symbols/chunks failed) / FAILED (no chunk made progress).
        """
        now = datetime.now(UTC)
        failed_symbols = sorted(state["failed_symbols"])
        if state["chunks_failed"] > 0 and state["chunks_done"] == 0:
            status = ingest_pb2.BACKFILL_STATUS_FAILED
        elif failed_symbols or state["chunks_failed"] > 0:
            status = ingest_pb2.BACKFILL_STATUS_PARTIAL
        else:
            status = ingest_pb2.BACKFILL_STATUS_COMPLETED

        await backfill_jobs.update_job(
            self._db,
            job_id,
            status=status,
            bars_processed=state["bars"],
            chunks_completed=state["chunks_done"],
            failed_symbols=failed_symbols,
            completed_at=now,
        )

        if status == ingest_pb2.BACKFILL_STATUS_FAILED:
            await self._emit_backfill_event(
                "ingest.backfill.failed",
                job_id,
                {"error": "all chunks failed", "failed_symbols": failed_symbols},
                propagation_meta,
            )
            await self._emit_backfill_alert(
                job_id, status, failed_symbols, "all backfill chunks failed", propagation_meta
            )
            log.error("backfill job %s failed: all chunk(s) errored", job_id)
        else:
            await self._emit_backfill_event(
                "ingest.backfill.completed",
                job_id,
                {"bars_written": state["bars"], "failed_symbols": failed_symbols},
                propagation_meta,
            )
            if status == ingest_pb2.BACKFILL_STATUS_PARTIAL:
                await self._emit_backfill_alert(
                    job_id,
                    status,
                    failed_symbols,
                    "some chunks/symbols failed to backfill",
                    propagation_meta,
                )
            log.info(
                "backfill job %s %s bars=%d chunks=%d/%d",
                job_id,
                "partial" if status == ingest_pb2.BACKFILL_STATUS_PARTIAL else "completed",
                state["bars"],
                state["chunks_done"],
                total_chunks,
            )

    async def resume_incomplete_jobs(self) -> int:
        """FR-3: on startup, re-drive jobs that still have PENDING/FAILED chunks. Returns count."""
        if self._db is None:
            return 0
        job_ids = await backfill_chunks.list_jobs_with_incomplete_chunks(self._db)
        for job_id in job_ids:
            asyncio.create_task(self._resume_job(job_id))
        return len(job_ids)

    async def _resume_job(self, job_id: str):
        row = await backfill_jobs.get_job(self._db, job_id)
        if row is None:
            return
        enum = row.get("timeframe_enum") or 0
        timeframe = _ENUM_TO_STR.get(enum) or _TF_ALIASES.get(
            row.get("timeframe") or "", row.get("timeframe") or "1d"
        )
        # Re-fetch is idempotent (marketdata upsert), so resume always uses overwrite=False.
        from types import SimpleNamespace

        req = SimpleNamespace(overwrite=False)
        await backfill_jobs.update_job(self._db, job_id, status=ingest_pb2.BACKFILL_STATUS_RUNNING)
        chunks = await backfill_chunks.get_incomplete_chunks(self._db, job_id)
        log.info("resuming backfill job %s with %d incomplete chunk(s)", job_id, len(chunks))
        state = await self._run_chunks(job_id, req, timeframe, chunks, ())
        await self._finalize_backfill(job_id, state, len(chunks), ())

    async def _run_chunks(self, job_id, request, timeframe, chunks, propagation_meta):
        """Execute chunks concurrently under the chunk-level semaphore (FR-6).

        Returns a state dict: bars, chunks_done, chunks_failed, failed_symbols (set).
        Job progress (bars_processed / chunks_completed) is advanced after each chunk.
        """
        sem = asyncio.Semaphore(self._cfg.backfill_max_concurrent_chunks)
        max_attempts = (
            self._cfg.backfill_max_retry_attempts if self._cfg.backfill_retry_on_failure else 0
        )
        tf_enum = _STR_TO_ENUM.get(timeframe, 0)
        state = {"bars": 0, "chunks_done": 0, "chunks_failed": 0, "failed_symbols": set()}
        lock = asyncio.Lock()

        async def run_one(chunk):
            chunk_id = str(chunk["chunk_id"])
            chunk_range = common_pb2.TimeRange(
                start=_dt_to_ts(chunk["range_start"]), end=_dt_to_ts(chunk["range_end"])
            )
            async with sem:
                await backfill_chunks.mark_chunk_running(self._db, chunk_id)
                remaining = list(chunk["symbols"])
                bars = 0
                failed: list[str] = []
                last_exc = None
                attempt = 0
                while True:
                    try:
                        resp = await self._marketdata.BackfillBars(
                            marketdata_pb2.BackfillBarsRequest(
                                symbols=remaining,
                                timeframe=timeframe,
                                timeframe_enum=tf_enum,
                                range=chunk_range,
                                overwrite_existing=request.overwrite,
                            ),
                            metadata=propagation_meta,
                        )
                        bars += resp.bars_written
                        failed = list(resp.failed_symbols)
                        last_exc = None
                    except Exception as e:  # transient RPC error — retry the whole chunk
                        last_exc = e
                        failed = remaining
                    if not failed or attempt >= max_attempts:
                        break
                    attempt += 1
                    await asyncio.sleep(2**attempt)  # 2s, 4s, 8s
                    remaining = failed

                async with lock:
                    if last_exc is not None and bars == 0:
                        # Chunk never succeeded (RPC kept raising) → FAILED, resumable later.
                        await backfill_chunks.mark_chunk_failed(
                            self._db, chunk_id, error=str(last_exc)
                        )
                        state["chunks_failed"] += 1
                        state["failed_symbols"].update(chunk["symbols"])
                        log.warning(
                            "backfill job %s chunk %s failed: %s", job_id, chunk_id, last_exc
                        )
                    else:
                        await backfill_chunks.mark_chunk_completed(
                            self._db, chunk_id, bars_written=bars
                        )
                        state["chunks_done"] += 1
                        state["bars"] += bars
                        if failed:
                            state["failed_symbols"].update(failed)
                    await backfill_jobs.update_job(
                        self._db,
                        job_id,
                        bars_processed=state["bars"],
                        chunks_completed=state["chunks_done"],
                    )

        await asyncio.gather(*(run_one(c) for c in chunks))
        return state

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
