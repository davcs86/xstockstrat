"""
IngestServicer — orchestrates historical backfills via xstockstrat-marketdata,
normalises raw data payloads, and persists newsletter signals to TimescaleDB.
"""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import grpc
from gen.common.v1 import common_pb2
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from gen.notify.v1 import notify_pb2, notify_pb2_grpc
from google.protobuf.json_format import MessageToDict, ParseDict
from google.protobuf.struct_pb2 import Struct
from google.protobuf.timestamp_pb2 import Timestamp

from app.admin_audit import AdminAuditError, audit_admin_read
from app.config.watcher import ConfigWatcher
from app.peer_identity import peer_san_matches
from app.repositories import backfill_chunks, backfill_jobs, source_templates
from app.repositories.signal_sources import (
    SYSTEM_OWNER,
    deactivate_source,
    derive_health_status,
    get_source,
    insert_source,
    list_all_sources,
    list_sources,
    mark_source_error,
    mark_source_fed,
    owner_scope_predicate,
    reactivate_source,
    slug_holders,
    touch_source_last_seen,
    update_source,
    validate_config_json,
)

log = logging.getLogger(__name__)

_SS_MASKABLE_PATHS = frozenset(
    {
        "display_name",
        "source_type",
        "extractor_module",
        "config_json",
        "credentials_ref",
        "reliability_weight",
    }
)
# slug is the PK; active is column-authoritative (lifecycle via reactivate/deactivate only).
_SS_COLUMN_AUTH_PATHS = frozenset({"slug", "active"})
_SS_CREDENTIAL_REQUIRED_TYPES = frozenset(
    {"authenticated_website", "mediated_authenticated_website", "mcp_client"}
)


class _SignalValidationError(Exception):
    """feature 166 — a signal that fails validation. Maps to INVALID_ARGUMENT at the RPC boundary;
    the scheduled mcp_client loop records it as source health error. Raised by
    _ingest_external_signal so both the IngestSignal RPC and the loop share one ingest path."""


class _SignalIngestError(Exception):
    """feature 166 — a persistence/dedup failure. Maps to INTERNAL at the RPC boundary."""


class _SignalSourceNotFound(Exception):
    """feature 224 — a headered caller holds no active source with that slug (NOT_FOUND, AC-10)."""


class _SignalSourceAmbiguous(Exception):
    """feature 224 — a headerless call names a slug held by several owners (FAILED_PRECONDITION)."""


class _SystemIdentityDenied(Exception):
    """feature 224 — `x-user-id: system` without a SAN-bound grant for the RPC (AC-33)."""


# `x-user-id: system` is honoured only with one of these `x-internal-caller` grants covering the
# RPC AND a verified mTLS peer SAN of _SYSTEM_GRANT_SAN — the header alone is forgeable.
_SYSTEM_GRANTS = {
    "analysis-fundsignal": frozenset({"ManageSignalSource", "IngestSignal"}),
    "analysis-system-read": frozenset({"QuerySignals", "ListSignalSources"}),
}
_SYSTEM_GRANT_SAN = "xstockstrat-analysis"


def _resolve_ss_operation(request) -> str | None:
    """Feature 088: prefer operation_enum; fall back to the deprecated string. Unknown → None."""
    enum_to_str = {
        ingest_pb2.SIGNAL_SOURCE_OPERATION_REGISTER: "register",
        ingest_pb2.SIGNAL_SOURCE_OPERATION_UPDATE: "update",
        ingest_pb2.SIGNAL_SOURCE_OPERATION_REACTIVATE: "reactivate",
        ingest_pb2.SIGNAL_SOURCE_OPERATION_DEACTIVATE: "deactivate",
    }
    if request.operation_enum != ingest_pb2.SIGNAL_SOURCE_OPERATION_UNSPECIFIED:
        return enum_to_str.get(request.operation_enum)
    op = request.operation
    return op if op in ("register", "update", "reactivate", "deactivate") else None


def _cfg_to_dict(value) -> dict | None:
    """Coerce a stored config_json (dict or JSON string, per asyncpg) to a dict, or None."""
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    return json.loads(str(value))


# The authorable SignalSource fields a template keeps: owner, credentials, health and origin are
# per-instance, so a template payload can never carry a credential (@feature-166 AC-2/AC-3).
_TEMPLATE_PAYLOAD_FIELDS = (
    "slug",
    "display_name",
    "source_type",
    "extractor_module",
    "config_json",
    "reliability_weight",
)


def _template_payload(src) -> dict:
    full = MessageToDict(src, preserving_proto_field_name=True)
    return {k: full[k] for k in _TEMPLATE_PAYLOAD_FIELDS if k in full}


def _template_to_proto(row: dict) -> ingest_pb2.SourceTemplate:
    payload = ingest_pb2.SignalSource()
    ParseDict(_cfg_to_dict(row["payload"]) or {}, payload, ignore_unknown_fields=True)
    meta = common_pb2.TemplateMeta(
        template_id=row["template_id"],
        kind=common_pb2.TEMPLATE_KIND_SIGNAL_SOURCE,
        name=row["name"],
        description=row["description"] or "",
        version=row["version"],
        retired=row["retired_at"] is not None,
    )
    if row.get("created_at"):
        meta.created_at.FromDatetime(row["created_at"])
    if row.get("updated_at"):
        meta.updated_at.FromDatetime(row["updated_at"])
    return ingest_pb2.SourceTemplate(meta=meta, payload=payload)


def _source_to_proto(row: dict, latest_versions: dict[str, int]) -> ingest_pb2.SignalSource:
    """A signal_sources row as a SignalSource; `latest_versions` resolves the origin's template."""
    cfg = Struct()
    cfg_dict = _cfg_to_dict(row["config_json"])
    if cfg_dict:
        cfg.update(cfg_dict)
    source = ingest_pb2.SignalSource(
        user_id=row.get("user_id") or "",
        slug=row["slug"],
        display_name=row["display_name"],
        source_type=row["source_type"],
        extractor_module=row["extractor_module"],
        active=row["active"],
        has_credentials=(row["credentials_ref"] is not None),
        config_json=cfg,
        reliability_weight=row.get("reliability_weight", 1.0),
    )
    template_id = row.get("origin_template_id")
    if template_id:
        version = row.get("origin_template_version") or 0
        latest = latest_versions.get(template_id, 0)  # 0 = retired or missing: no update
        source.origin.CopyFrom(
            common_pb2.TemplateOrigin(
                template_id=template_id,
                template_version=version,
                latest_version=latest,
                update_available=latest > version,
            )
        )
    return source


def _weight_error(src) -> str | None:
    if src.HasField("reliability_weight") and not (0.0 <= src.reliability_weight <= 1.0):
        return "reliability_weight must be between 0.0 and 1.0"
    return None


# Source-health string → SourceHealthStatus enum.
_HEALTH_ENUM = {
    "live": ingest_pb2.SOURCE_HEALTH_STATUS_LIVE,
    "stale": ingest_pb2.SOURCE_HEALTH_STATUS_STALE,
    "down": ingest_pb2.SOURCE_HEALTH_STATUS_DOWN,
    "unspecified": ingest_pb2.SOURCE_HEALTH_STATUS_UNSPECIFIED,
}

# Canonical timeframe <-> marketdata Timeframe enum int (mirrors marketdata's table).
# 1m/5m enums intentionally omitted so sub-15m intervals no longer resolve.
_STR_TO_ENUM = {"15m": 5, "1h": 3, "1d": 4}
_ENUM_TO_STR = {v: k for k, v in _STR_TO_ENUM.items()}
# Backfill data-kind <-> DB string (feature 198). The DB column stores 'BARS'/'FUNDAMENTALS'.
_DATA_KIND_STR_TO_ENUM = {
    "BARS": ingest_pb2.BACKFILL_DATA_KIND_BARS,
    "FUNDAMENTALS": ingest_pb2.BACKFILL_DATA_KIND_FUNDAMENTALS,
}
# Normalizes the legacy "1Day" spelling on the read path (_row_timeframe); real "1Day"
# rows exist. Only "1d" is servable, so no other legacy spellings are mapped.
_TF_ALIASES = {
    "1d": "1d",
    "1Day": "1d",
}


def _row_timeframe(stored: str) -> str:
    """Normalize a stored backfill_jobs.timeframe to its canonical spelling.

    The column is TEXT NOT NULL DEFAULT '' with no CHECK constraint
    (migrations/003_backfill_jobs.up.sql), so a legacy row may hold an alias
    ("1Day"). Alias-hop first so the read path resolves exactly what the resume
    path already resolves (feature 080 FR-1).
    """
    return _TF_ALIASES.get(stored, stored)


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
        # The deprecated string is omitted (feature 196); unknown/empty degrades to
        # TIMEFRAME_UNSPECIFIED rather than raising.
        timeframe_enum=_STR_TO_ENUM.get(_row_timeframe(row["timeframe"] or ""), 0),
        status=row["status"],
        bars_processed=row["bars_processed"] or 0,
        bars_total=row["bars_total"] or 0,
        chunks_total=row["chunks_total"] or 0,
        chunks_completed=row["chunks_completed"] or 0,
        failed_symbols=list(row["failed_symbols"] or []),
        error=row["error"] or "",
        data_kind=_DATA_KIND_STR_TO_ENUM.get(
            (row.get("data_kind") or "BARS"), ingest_pb2.BACKFILL_DATA_KIND_BARS
        ),
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
        # Concurrency gate: read once at init (not live-reread). Jobs above the limit stay
        # QUEUED until the semaphore is acquired.
        self._backfill_sem = asyncio.Semaphore(self._cfg.backfill_max_concurrent_jobs)
        # In-process registry of canceled job_ids; checked before launching further chunks
        # so completed-chunk bars are retained.
        self._canceled_jobs: set[str] = set()

    @staticmethod
    def _has_admin_scope(context) -> bool:
        """Role check on the propagated x-access-scope ADMIN bit (0x04).

        Internal services trust the access scope set by the entry points (UI BFF via JWT,
        MCP agent via its OAuth 2.1 Streamable HTTP auth layer) and do a role check at
        most — they do not re-authenticate. Mirrors the analysis servicer's gate
        (feature 049 Part A).
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

    @staticmethod
    def _resolve_owner(context, rpc: str) -> str | None:
        """The caller's owner id: `x-user-id`, or None when headerless (release-N tolerance).

        Raises _SystemIdentityDenied for `system` without a SAN-bound grant covering `rpc`.
        """
        metadata = {k: v for k, v in context.invocation_metadata()}
        user_id = metadata.get("x-user-id") or None
        if user_id != SYSTEM_OWNER:
            return user_id
        caller = metadata.get("x-internal-caller", "")
        if rpc in _SYSTEM_GRANTS.get(caller, ()) and peer_san_matches(context, _SYSTEM_GRANT_SAN):
            return SYSTEM_OWNER
        raise _SystemIdentityDenied(f"x-user-id '{SYSTEM_OWNER}' is not granted {rpc}")

    async def _owner_or_abort(self, context, rpc: str) -> tuple[bool, str | None]:
        try:
            return True, self._resolve_owner(context, rpc)
        except _SystemIdentityDenied as e:
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, str(e))
            return False, None

    def _admin_foreign_owner(self, context, owner: str | None, requested: str) -> str | None:
        """FR-13: the `owner_user_id` selector, honoured only for a headered ADMIN reading another
        owner; anyone else's selector is ignored."""
        if owner is None or not requested or requested == owner:
            return None
        return requested if self._has_admin_scope(context) else None

    async def _audit_or_abort(self, context, admin_id, object_kind, ids_by_owner) -> bool:
        try:
            await audit_admin_read(
                self._ledger, admin_id, object_kind, ids_by_owner, context.invocation_metadata()
            )
            return True
        except AdminAuditError as e:
            await context.abort(grpc.StatusCode.UNAVAILABLE, str(e))
            return False

    async def TriggerBackfill(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        # Admin-gate this quota-spending op. After the _db check so an unconfigured DB still
        # returns UNAVAILABLE.
        if not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
            return
        job_id = str(uuid.uuid4())
        propagation_meta = self._propagation_meta(context)
        # feature 198: fundamentals ride a distinct data-kind axis, never the bar-timeframe axis.
        # A FUNDAMENTALS job skips the 1d timeframe reject entirely (it has no bar timeframe, @AC-6)
        # and stores an empty timeframe with data_kind='FUNDAMENTALS'.
        is_fundamentals = request.data_kind == ingest_pb2.BACKFILL_DATA_KIND_FUNDAMENTALS
        if is_fundamentals:
            canonical_tf = ""
            data_kind = "FUNDAMENTALS"
        else:
            # Canonicalize BEFORE persisting: _canonical_timeframe prefers the request enum, so an
            # enum-only caller (the UI) no longer stores '' as the timeframe.
            canonical_tf = _canonical_timeframe(request)
            data_kind = "BARS"
            # Only "1d" is servable — reject before persisting a job or spending quota.
            # Mirrors marketdata's own GetBars/BackfillBars gate. (BARS path only.)
            if canonical_tf != "1d":
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    f"timeframe {canonical_tf!r} not supported; only '1d' is servable",
                )
                return
        await backfill_jobs.insert_job(
            self._db,
            job_id=job_id,
            symbols=list(request.symbols),
            timeframe=canonical_tf,
            range_start=_ts_to_dt(request.range.start),
            range_end=_ts_to_dt(request.range.end),
            status=ingest_pb2.BACKFILL_STATUS_QUEUED,
            data_kind=data_kind,
        )
        await self._emit_backfill_event(
            "ingest.backfill.queued",
            job_id,
            # Untyped Struct payload — no lint/type check covers it, so it must carry the
            # canonical value too.
            {"symbols": list(request.symbols), "timeframe": canonical_tf, "data_kind": data_kind},
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
            # A job above max_concurrent_jobs blocks on the semaphore here, staying QUEUED
            # until it is free, then transitions to RUNNING.
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
                if request.data_kind == ingest_pb2.BACKFILL_DATA_KIND_FUNDAMENTALS:
                    await self._execute_fundamentals_backfill(
                        job_id, request, symbols, propagation_meta
                    )
                else:
                    await self._execute_backfill(job_id, request, symbols, propagation_meta)
        except Exception as e:
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

    async def _execute_fundamentals_backfill(self, job_id, request, symbols, propagation_meta):
        """Feature 198: a fundamentals job bypasses the bar-density chunk planner (no bars). One
        marketdata.BackfillFundamentals call fetches the as-reported EDGAR periods + PIT price-join
        and persists them for all symbols (marketdata iterates per symbol, fail-closed via ON
        CONFLICT DO NOTHING — a same-range re-run is idempotent, @AC-1). Period types come from
        marketdata's own config default when unset (@AC-2, both quarterly + annual)."""
        resp = await self._marketdata.BackfillFundamentals(
            marketdata_pb2.BackfillFundamentalsRequest(
                symbols=list(symbols),
                range=request.range,
                overwrite=request.overwrite,
            ),
            metadata=propagation_meta,
        )
        failed = list(resp.failed_symbols)
        status = (
            ingest_pb2.BACKFILL_STATUS_PARTIAL if failed else ingest_pb2.BACKFILL_STATUS_COMPLETED
        )
        await backfill_jobs.update_job(
            self._db,
            job_id,
            status=status,
            bars_processed=int(resp.periods_written),  # reused as periods-written for fundamentals
            failed_symbols=failed,
            completed_at=datetime.now(UTC),
        )
        await self._emit_backfill_event(
            "ingest.backfill.completed",
            job_id,
            {
                "periods_written": int(resp.periods_written),
                "failed_symbols": failed,
                "data_kind": "FUNDAMENTALS",
            },
            propagation_meta,
        )
        log.info(
            "fundamentals backfill job %s completed: %d periods, %d failed symbols",
            job_id,
            resp.periods_written,
            len(failed),
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
        # If a cancel landed while chunks were draining, don't overwrite CANCELED with a
        # completed/partial status. The in-process registry is authoritative for the live run.
        if job_id in self._canceled_jobs:
            self._canceled_jobs.discard(job_id)
            return
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
        # backfill_jobs has no timeframe_enum column, so the stored string is the only source.
        # _ENUM_TO_STR stays because _canonical_timeframe reads it on the write path.
        timeframe = _row_timeframe(row.get("timeframe") or "") or "1d"
        # Re-fetch is idempotent (marketdata upsert), so resume always uses overwrite=False.
        from types import SimpleNamespace

        req = SimpleNamespace(overwrite=False)
        await backfill_jobs.update_job(self._db, job_id, status=ingest_pb2.BACKFILL_STATUS_RUNNING)
        chunks = await backfill_chunks.get_incomplete_chunks(self._db, job_id)
        log.info("resuming backfill job %s with %d incomplete chunk(s)", job_id, len(chunks))
        state = await self._run_chunks(job_id, req, timeframe, chunks, ())
        await self._finalize_backfill(job_id, state, len(chunks), ())

    def _effective_max_attempts(self) -> int:
        return self._cfg.backfill_max_retry_attempts if self._cfg.backfill_retry_on_failure else 0

    async def _run_chunks(self, job_id, request, timeframe, chunks, propagation_meta):
        """Execute chunks concurrently under the chunk-level semaphore (FR-6).

        Returns a state dict: bars, chunks_done, chunks_failed, failed_symbols (set).
        Job progress (bars_processed / chunks_completed) is advanced after each chunk.
        """
        sem = asyncio.Semaphore(self._cfg.backfill_max_concurrent_chunks)
        max_attempts = self._effective_max_attempts()
        tf_enum = _STR_TO_ENUM.get(timeframe, 0)
        state = {"bars": 0, "chunks_done": 0, "chunks_failed": 0, "failed_symbols": set()}
        lock = asyncio.Lock()

        async def run_one(chunk):
            chunk_id = str(chunk["chunk_id"])
            # If the job was canceled, stop before acquiring the semaphore / issuing BackfillBars.
            # Already-completed chunks keep their bars; this chunk is simply not fetched.
            if job_id in self._canceled_jobs:
                return
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
                    except grpc.aio.AioRpcError as e:
                        last_exc = e
                        failed = remaining
                        if e.code() == grpc.StatusCode.INVALID_ARGUMENT:
                            # Permanent rejection (e.g. marketdata's 1d-only gate) — retrying
                            # cannot succeed.
                            attempt = max_attempts
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
        symbol_filter = request.symbol or None
        rows = await backfill_jobs.list_jobs(
            self._db,
            status_filter=status_filter,
            symbol_filter=symbol_filter,
            limit=limit,
            offset=offset,
        )
        next_token = str(offset + len(rows)) if len(rows) == limit else ""
        return ingest_pb2.ListBackfillJobsResponse(
            jobs=[job_row_to_proto(r) for r in rows],
            page=common_pb2.PageResponse(next_page_token=next_token, total_count=len(rows)),
        )

    async def CancelBackfill(self, request, context):
        """Cancel a QUEUED/RUNNING backfill job (admin-only, FR-4).

        Sets the job to CANCELED and registers it so the in-flight runner stops scheduling
        further chunks; completed-chunk bars are retained (no rollback). Returns the updated job.
        """
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        if not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
            return
        row = await backfill_jobs.get_job(self._db, request.job_id)
        if row is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, f"job {request.job_id} not found")
            return
        if row["status"] not in (
            ingest_pb2.BACKFILL_STATUS_QUEUED,
            ingest_pb2.BACKFILL_STATUS_RUNNING,
        ):
            state_name = ingest_pb2.BackfillStatus.Name(row["status"])
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION,
                f"job not cancelable in state {state_name}",
            )
            return
        # Register the cancellation first so any chunk that checks the flag after this point stops.
        self._canceled_jobs.add(request.job_id)
        await backfill_jobs.update_job(
            self._db,
            request.job_id,
            status=ingest_pb2.BACKFILL_STATUS_CANCELED,
            completed_at=datetime.now(UTC),
        )
        await self._emit_backfill_event(
            "ingest.backfill.canceled",
            request.job_id,
            {"canceled": True},
            self._propagation_meta(context),
        )
        return job_row_to_proto(await backfill_jobs.get_job(self._db, request.job_id))

    async def NormalizeRawData(self, request, context):
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
        ok, owner = await self._owner_or_abort(context, "IngestSignal")
        if not ok:
            return
        try:
            signal_id, deduplicated = await self._ingest_external_signal(
                request.signal, propagation_meta, owner=owner
            )
        except _SignalValidationError as e:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return
        except _SignalSourceNotFound as e:
            await context.abort(grpc.StatusCode.NOT_FOUND, str(e))
            return
        except _SignalSourceAmbiguous as e:
            await context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(e))
            return
        except _SignalIngestError as e:
            await context.abort(grpc.StatusCode.INTERNAL, str(e))
            return
        return ingest_pb2.IngestSignalResponse(signal_id=signal_id, deduplicated=deduplicated)

    async def _ingest_external_signal(
        self, signal, propagation_meta=None, owner: str | None = None
    ) -> tuple[int, bool]:
        """feature 166 — the validate + persist + dedup + health + ledger core of IngestSignal,
        raising _SignalValidationError / _SignalIngestError instead of aborting a gRPC context so
        both the RPC and the scheduled mcp_client loop drive one ingest path. Returns
        (signal_id, deduplicated).

        feature 224: the signal is filed under `owner`; None (headerless, release N only)
        resolves the slug's unique holder."""
        propagation_meta = propagation_meta or []

        if not signal.source or not signal.symbol or not signal.direction:
            raise _SignalValidationError("source, symbol, and direction are required")

        valid_directions = {"buy", "sell", "hold", "watchlist"}
        if signal.direction not in valid_directions:
            raise _SignalValidationError(f"direction must be one of {valid_directions}")

        # Inverted-range form also rejects NaN (all NaN comparisons are False), which `<0 or >1`
        # would leak to the `>0.0` NULL-sentinel below. 0.0 passes and is stored as NULL.
        if not (0.0 <= signal.conviction <= 1.0):
            raise _SignalValidationError("conviction must be between 0.0 and 1.0")

        # Source slug must be registered and active — for the owner. A headered miss is NOT_FOUND
        # (a foreign slug is indistinguishable from a missing one); headerless keeps
        # INVALID_ARGUMENT for zero holders.
        missing = _SignalSourceNotFound(f"source '{signal.source}' not found")
        if owner is None:
            holders = await slug_holders(self._db, signal.source)
            if len(holders) > 1:
                raise _SignalSourceAmbiguous(
                    f"source slug '{signal.source}' has several owners; x-user-id required"
                )
            missing = _SignalValidationError(
                f"source slug '{signal.source}' is not a registered active source"
            )
            if not holders:
                raise missing
            owner = holders[0]
        source_row = await self._db.fetchrow(
            "SELECT slug FROM ingest.signal_sources"
            " WHERE user_id = $1 AND slug = $2 AND active = TRUE",
            owner,
            signal.source,
        )
        if source_row is None:
            raise missing

        valid_from = signal.valid_from.ToDatetime(tzinfo=UTC)
        valid_until = None
        if signal.HasField("valid_until") and signal.valid_until.seconds > 0:
            valid_until = signal.valid_until.ToDatetime(tzinfo=UTC)

        conviction = signal.conviction if signal.conviction > 0.0 else None

        symbol_upper = signal.symbol.upper()

        class _DuplicateSignal(Exception):
            """Internal control-flow signal only: the dedup claim's WHERE evaluated false —
            force the `async with conn.transaction():` block below to ROLLBACK the
            speculative newsletter_signals insert. Never crosses the RPC boundary."""

        deduplicated = False
        try:
            async with self._db.acquire() as conn, conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO ingest.newsletter_signals
                        (source, symbol, direction, conviction,
                         valid_from, valid_until, headline, raw_url, tags, user_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING id
                    """,
                    signal.source,
                    symbol_upper,
                    signal.direction,
                    conviction,
                    valid_from,
                    valid_until,
                    signal.headline or None,
                    signal.raw_url or None,
                    list(signal.tags) if signal.tags else [],
                    owner,
                )
                candidate_id = row["id"]

                claim = await conn.fetchrow(
                    """
                    INSERT INTO ingest.signal_dedup_claims
                        (user_id, source, symbol, direction, signal_id, conviction, valid_until,
                         claimed_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    ON CONFLICT (user_id, source, symbol, direction) DO UPDATE
                        SET signal_id = EXCLUDED.signal_id,
                            conviction = EXCLUDED.conviction,
                            valid_until = EXCLUDED.valid_until,
                            claimed_at = EXCLUDED.claimed_at
                        WHERE ingest.signal_dedup_claims.claimed_at
                                  < NOW() - make_interval(hours => $8::int)
                           OR ingest.signal_dedup_claims.conviction
                                  IS DISTINCT FROM EXCLUDED.conviction
                           OR ingest.signal_dedup_claims.valid_until
                                  IS DISTINCT FROM EXCLUDED.valid_until
                    RETURNING signal_id
                    """,
                    owner,
                    signal.source,
                    symbol_upper,
                    signal.direction,
                    candidate_id,
                    conviction,
                    valid_until,
                    self._cfg.dedup_window_hours,
                )
                if claim is None:
                    # Raising inside the transaction forces the ROLLBACK; this except MUST stay
                    # ordered before the generic `except Exception`, or dedup inserts a 2nd row.
                    raise _DuplicateSignal()
                signal_id = candidate_id
        except _DuplicateSignal:
            deduplicated = True
            existing = await self._db.fetchrow(
                "SELECT signal_id FROM ingest.signal_dedup_claims "
                "WHERE user_id = $1 AND source = $2 AND symbol = $3 AND direction = $4",
                owner,
                signal.source,
                symbol_upper,
                signal.direction,
            )
            if existing is None:
                # Unreachable in normal operation — nothing deletes signal_dedup_claims rows.
                raise _SignalIngestError("dedup claim lost")
            signal_id = existing["signal_id"]
        except Exception as e:
            log.error("failed to insert signal: %s", e)
            try:  # record the source's last error (best-effort)
                await mark_source_error(self._db, owner, signal.source, str(e))
            except Exception as bookkeeping_err:
                log.warning(
                    "failed to record source error for %s: %s", signal.source, bookkeeping_err
                )
            raise _SignalIngestError(f"database error: {e}")

        if not deduplicated:
            # Record a successful feed (best-effort). Gated to the non-duplicate path — a
            # dedup hit performed no new ingest.
            try:
                await mark_source_fed(self._db, owner, signal.source)
            except Exception as e:
                log.warning("failed to record source feed for %s: %s", signal.source, e)

            log.info(
                "ingested signal id=%d source=%s symbol=%s direction=%s",
                signal_id,
                signal.source,
                signal.symbol,
                signal.direction,
            )

            from google.protobuf.struct_pb2 import Struct

            payload = Struct()
            payload.update(
                {
                    "signal_id": signal_id,
                    "user_id": owner,
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
        else:
            # A dedup hit still means the source is alive: bump last_seen_at but NOT
            # signals_fed, so a source resending a still-current signal doesn't read as STALE.
            try:
                await touch_source_last_seen(self._db, owner, signal.source)
            except Exception as e:
                log.warning("failed to touch last_seen for %s: %s", signal.source, e)
            log.info(
                "deduplicated signal source=%s symbol=%s direction=%s -> signal_id=%d",
                signal.source,
                signal.symbol,
                signal.direction,
                signal_id,
            )

        return signal_id, deduplicated

    async def QuerySignals(self, request, context):
        """Query active signals filtered by owner scope, source/symbol/direction and time window."""
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        ok, owner = await self._owner_or_abort(context, "QuerySignals")
        if not ok:
            return
        foreign = self._admin_foreign_owner(context, owner, request.owner_user_id)

        conditions = []
        params = []
        idx = 1

        # Headerless (release N only) stays unscoped; headered reads are owner-scoped.
        if foreign is not None:
            conditions.append(f"user_id = ${idx}")
            params.append(foreign)
            idx += 1
        elif owner is not None:
            predicate, uses_param = owner_scope_predicate(request.scope, idx)
            conditions.append(predicate)
            if uses_param:
                params.append(owner)
                idx += 1

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

        limit = request.page.page_size if request.page.page_size > 0 else 100
        offset_val = request.page.page_token  # reuse as integer offset for simplicity

        try:
            offset_int = int(offset_val) if offset_val else 0
        except ValueError:
            offset_int = 0

        try:
            rows = await self._db.fetch(
                f"""
                SELECT id, user_id, source, symbol, direction, conviction, valid_from,
                       valid_until, headline, raw_url, tags, ingested_at
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
        if foreign is not None and not await self._audit_or_abort(
            context, owner, "signal", {foreign: [str(row["id"]) for row in rows]}
        ):
            return

        signals = []
        for row in rows:
            sig = ingest_pb2.ExternalSignal(
                user_id=row.get("user_id") or "",
                source=row["source"],
                symbol=row["symbol"],
                direction=row["direction"],
                conviction=float(row["conviction"]) if row["conviction"] is not None else 0.0,
                headline=row["headline"] or "",
                raw_url=row["raw_url"] or "",
                tags=list(row["tags"]) if row["tags"] else [],
            )
            vf = Timestamp()
            vf.FromDatetime(row["valid_from"])
            sig.valid_from.CopyFrom(vf)
            if row["valid_until"] is not None:
                vu = Timestamp()
                vu.FromDatetime(row["valid_until"])
                sig.valid_until.CopyFrom(vu)
            # ingested_at is NOT NULL (DB default NOW()) so no null guard is needed; it's the
            # age input for analysis's signal decay.
            sig.ingested_at.FromDatetime(row["ingested_at"])
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
        ok, owner = await self._owner_or_abort(context, "ListSignalSources")
        if not ok:
            return
        foreign = self._admin_foreign_owner(context, owner, request.owner_user_id)
        if foreign is not None:
            rows = await list_sources(
                self._db, foreign, ingest_pb2.SIGNAL_SCOPE_OWN, request.include_inactive
            )
            if not await self._audit_or_abort(
                context, owner, "signal_source", {foreign: [row["slug"] for row in rows]}
            ):
                return
        elif owner is not None:
            rows = await list_sources(
                self._db, owner, ingest_pb2.SIGNAL_SCOPE_UNSPECIFIED, request.include_inactive
            )
        else:  # headerless (release N only): today's global listing
            rows = await list_all_sources(self._db, include_inactive=request.include_inactive)
        template_ids = sorted(
            {r["origin_template_id"] for r in rows if r.get("origin_template_id")}
        )
        latest = (
            await source_templates.latest_versions(self._db, template_ids) if template_ids else {}
        )
        now = datetime.now(UTC)
        sources = []
        for row in rows:
            source = _source_to_proto(row, latest)
            # Health is derived on read from last_seen_at freshness + last_error.
            last_seen = row.get("last_seen_at")
            last_error = row.get("last_error")
            source.health = _HEALTH_ENUM[derive_health_status(last_seen, last_error, now)]
            source.last_error = last_error or ""
            source.signals_fed = row.get("signals_fed") or 0
            if last_seen is not None:
                source.last_seen_at.FromDatetime(last_seen)
            sources.append(source)
        return ingest_pb2.ListSignalSourcesResponse(sources=sources)

    @staticmethod
    def _validate_source_write(
        source_type: str, config_json: dict | None, credentials_ref: str | None
    ) -> str | None:
        """Feature 088: validate a register/update write on the *effective* (post-merge) fields.
        Covers config_json shape and the credential-required rule for both credential types
        (closing the mediated_authenticated_website gap)."""
        err = validate_config_json(source_type, config_json)
        if err:
            return err
        if source_type in _SS_CREDENTIAL_REQUIRED_TYPES and not credentials_ref:
            return f"{source_type} source requires credentials_ref"
        return None

    @staticmethod
    def _register_conflict(owner: str | None, slug: str, holders: list[str]):
        """(code, message) refusing a REGISTER of `slug` given its current holders, else None.

        A slug held by `system` is reserved (AC-36); headerless N never creates (elaboration 5).
        """
        exists = (grpc.StatusCode.ALREADY_EXISTS, f"source '{slug}' already exists")
        if owner is None:
            if holders:
                return exists
            return grpc.StatusCode.FAILED_PRECONDITION, "x-user-id required to register a source"
        if owner != SYSTEM_OWNER and SYSTEM_OWNER in holders:
            return exists
        if owner == SYSTEM_OWNER and any(h != SYSTEM_OWNER for h in holders):
            return grpc.StatusCode.FAILED_PRECONDITION, f"slug '{slug}' is already held by a user"
        return exists if owner in holders else None

    async def _abort_missing_source(self, context, owner: str | None, slug: str) -> None:
        """No row for (owner, slug): a system-held slug is read-only to every non-system caller
        (AC-26); anything else is NOT_FOUND (a foreign user's slug is indistinguishable)."""
        if owner not in (None, SYSTEM_OWNER) and SYSTEM_OWNER in await slug_holders(self._db, slug):
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, f"system source '{slug}' is read-only"
            )
            return
        await context.abort(grpc.StatusCode.NOT_FOUND, f"source '{slug}' not found")

    async def ManageSignalSource(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        ok, owner = await self._owner_or_abort(context, "ManageSignalSource")
        if not ok:
            return
        # Owners manage their own sources; only the headerless (release N) path keeps the admin
        # gate. No caller — admin included — reaches another owner's source.
        if owner is None and not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
            return
        op = _resolve_ss_operation(request)
        src = request.source
        if op is None:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "unknown operation: must be register, update, reactivate, or deactivate",
            )
            return
        target = owner
        if owner is None and op != "register":
            holders = await slug_holders(self._db, src.slug)
            if not holders:
                await context.abort(grpc.StatusCode.NOT_FOUND, f"source '{src.slug}' not found")
                return
            if len(holders) > 1:
                await context.abort(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    f"source slug '{src.slug}' has several owners; x-user-id required",
                )
                return
            target = holders[0]
        if op == "reactivate":
            row = await reactivate_source(self._db, target, src.slug)
            if row is None:
                await self._abort_missing_source(context, owner, src.slug)
                return
        elif op == "deactivate":
            row = await deactivate_source(self._db, target, src.slug)
            if row is None:
                await self._abort_missing_source(context, owner, src.slug)
                return
        elif op == "register":
            # MessageToDict, not dict(): dict() keeps nested Struct/ListValue protobuf objects as
            # values, which neither json.dumps nor asyncpg can encode.
            row, failure = await self._register_source(owner, src, request.credentials_ref)
            if failure:
                await context.abort(*failure)
                return
        else:  # update — AIP-161 partial merge onto the stored row
            stored = await get_source(self._db, target, src.slug)
            if stored is None:
                await self._abort_missing_source(context, owner, src.slug)
                return
            has_mask = request.HasField("update_mask")
            mask = set(request.update_mask.paths) if has_mask else None
            if has_mask:
                authoritative = mask & _SS_COLUMN_AUTH_PATHS
                if authoritative:
                    await context.abort(
                        grpc.StatusCode.INVALID_ARGUMENT,
                        f"cannot update column-authoritative field(s) {sorted(authoritative)} via "
                        "update_mask; use reactivate/deactivate for `active`",
                    )
                    return
                unknown = mask - _SS_MASKABLE_PATHS
                if unknown:
                    await context.abort(
                        grpc.StatusCode.INVALID_ARGUMENT,
                        f"unknown update_mask path(s): {sorted(unknown)}",
                    )
                    return

            def _use_req(field: str) -> bool:
                return mask is None or field in mask

            merged_display = (
                src.display_name if _use_req("display_name") else stored["display_name"]
            )
            merged_type = src.source_type if _use_req("source_type") else stored["source_type"]
            merged_extractor = (
                src.extractor_module if _use_req("extractor_module") else stored["extractor_module"]
            )
            merged_cfg = (
                (MessageToDict(src.config_json) if src.config_json else None)
                if _use_req("config_json")
                else _cfg_to_dict(stored["config_json"])
            )
            # credentials_ref is a virtual mask path (not on the SignalSource message): masked →
            # apply the request value (empty string clears); unlisted → preserve the stored ref.
            merged_cred = (
                (request.credentials_ref or None)
                if _use_req("credentials_ref")
                else stored["credentials_ref"]
            )
            err = self._validate_source_write(merged_type, merged_cfg, merged_cred)
            if err:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, err)
                return
            # Reject an out-of-range explicit weight, then merge: masked + present → request
            # value; else preserve the stored weight (never None on the NOT NULL column).
            weight_err = _weight_error(src)
            if weight_err:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, weight_err)
                return
            merged_weight = (
                src.reliability_weight
                if (_use_req("reliability_weight") and src.HasField("reliability_weight"))
                else stored["reliability_weight"]
            )
            row = await update_source(
                self._db,
                user_id=target,
                slug=src.slug,
                display_name=merged_display,
                source_type=merged_type,
                extractor_module=merged_extractor,
                credentials_ref=merged_cred,
                config_json=merged_cfg,
                reliability_weight=merged_weight,
            )
            if row is None:
                await context.abort(grpc.StatusCode.NOT_FOUND, f"source '{src.slug}' not found")
                return

        return ingest_pb2.ManageSignalSourceResponse(source=_source_to_proto(row, {}))

    async def _register_source(self, owner, src, credentials_ref: str, origin=None):
        """The REGISTER path shared with InstantiateTemplate: returns (row, None) or
        (None, (code, message)). `origin` = (template_id, version) stamps the new row."""
        # MessageToDict, not dict(): dict() keeps nested Struct/ListValue protobuf objects as
        # values, which neither json.dumps nor asyncpg can encode.
        cfg_dict = MessageToDict(src.config_json) if src.config_json else None
        cred = credentials_ref or None
        async with self._db.acquire() as conn, conn.transaction():
            # Serializes every REGISTER of one slug so the reserved-slug holder check below
            # cannot race a concurrent register by another owner.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", src.slug)
            # Strict create: an existing slug is a conflict, not a silent overwrite.
            failure = self._register_conflict(owner, src.slug, await slug_holders(conn, src.slug))
            if failure:
                return None, failure
            # An omitted weight resolves to the 1.0 default. Never pass None — the NOT NULL
            # column would raise.
            err = self._validate_source_write(src.source_type, cfg_dict, cred) or _weight_error(src)
            if err:
                return None, (grpc.StatusCode.INVALID_ARGUMENT, err)
            row = await insert_source(
                conn,
                slug=src.slug,
                display_name=src.display_name,
                source_type=src.source_type,
                extractor_module=src.extractor_module,
                credentials_ref=cred,
                config_json=cfg_dict,
                active=True,
                reliability_weight=(
                    src.reliability_weight if src.HasField("reliability_weight") else 1.0
                ),
                user_id=owner,
            )
            if origin is not None:
                row = await source_templates.stamp_origin(conn, owner, src.slug, *origin)
        return row, None

    async def ListTemplates(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        ok, _ = await self._owner_or_abort(context, "ListTemplates")
        if not ok:
            return
        rows = await source_templates.list_active(self._db)
        return ingest_pb2.ListTemplatesResponse(templates=[_template_to_proto(r) for r in rows])

    async def ManageTemplate(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        ok, owner = await self._owner_or_abort(context, "ManageTemplate")
        if not ok:
            return
        if not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
            return
        op = request.operation
        meta = request.template.meta
        if op == common_pb2.TEMPLATE_OPERATION_RETIRE:
            row = await source_templates.retire(self._db, meta.template_id)
        elif op in (common_pb2.TEMPLATE_OPERATION_CREATE, common_pb2.TEMPLATE_OPERATION_UPDATE):
            src = request.template.payload
            cfg_dict = MessageToDict(src.config_json) if src.config_json else None
            err = validate_config_json(src.source_type, cfg_dict) or _weight_error(src)
            if err:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, err)
                return
            payload = _template_payload(src)
            if op == common_pb2.TEMPLATE_OPERATION_UPDATE:
                row = await source_templates.update(
                    self._db, meta.template_id, meta.name, meta.description, payload
                )
            else:
                try:
                    row = await source_templates.create(
                        self._db,
                        template_id=meta.template_id or str(uuid.uuid4()),
                        name=meta.name,
                        description=meta.description,
                        payload=payload,
                        created_by=owner or "",
                    )
                except asyncpg.UniqueViolationError:
                    await context.abort(
                        grpc.StatusCode.ALREADY_EXISTS,
                        f"template '{meta.template_id}' already exists",
                    )
                    return
        else:
            await context.abort(
                grpc.StatusCode.INVALID_ARGUMENT,
                "unknown operation: must be create, update, or retire",
            )
            return
        if row is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"template '{meta.template_id}' not found"
            )
            return
        return _template_to_proto(row)

    async def InstantiateTemplate(self, request, context):
        if self._db is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "database not connected")
            return
        ok, owner = await self._owner_or_abort(context, "InstantiateTemplate")
        if not ok:
            return
        if owner is None:
            await context.abort(
                grpc.StatusCode.FAILED_PRECONDITION, "x-user-id required to instantiate a template"
            )
            return
        tpl = await source_templates.get(self._db, request.template_id)
        if tpl is None or tpl["retired_at"] is not None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"template '{request.template_id}' not found"
            )
            return
        src = _template_to_proto(tpl).payload
        src.slug = request.slug or src.slug
        if not src.slug:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "slug is required")
            return
        row, failure = await self._register_source(
            owner, src, request.credentials_ref, origin=(tpl["template_id"], tpl["version"])
        )
        if failure:
            await context.abort(*failure)
            return
        return _source_to_proto(row, {tpl["template_id"]: tpl["version"]})
