"""Hand-off of finished backfill jobs to notify's webhook fan-out (feature 334).

One background task. Each cycle selects terminal jobs that carry a callback URL and were never
handed off, and asks notify (`FanoutWebhook`) to deliver one event per job. Notify owns the URL
rule, the delivery and its retries; this loop only records that notify accepted or refused the
job. A job is handed off at most once.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid

import grpc
from gen.ingest.v1 import ingest_pb2
from gen.notify.v1 import notify_pb2
from google.protobuf.struct_pb2 import Struct

from app.repositories import backfill_jobs
from app.telemetry import Loop, log_tick_ok

log = logging.getLogger(__name__)

_BATCH_SIZE = 50
_FANOUT_WEBHOOK_TIMEOUT_S = 5
_STATUS_PREFIX = "BACKFILL_STATUS_"
_EVENT_NAMES = {
    ingest_pb2.BACKFILL_STATUS_COMPLETED: "ingest.backfill.completed",
    ingest_pb2.BACKFILL_STATUS_PARTIAL: "ingest.backfill.completed",
    ingest_pb2.BACKFILL_STATUS_FAILED: "ingest.backfill.failed",
    ingest_pb2.BACKFILL_STATUS_CANCELED: "ingest.backfill.canceled",
}


def _iso(dt) -> str | None:
    return dt.isoformat() if dt is not None else None


def _fanout_request(row: dict, job_id: str) -> notify_pb2.FanoutWebhookRequest:
    status_name = ingest_pb2.BackfillStatus.Name(row["status"]).removeprefix(_STATUS_PREFIX)
    # Row columns only, and never `error`: it can carry internal addresses.
    payload = Struct()
    payload.update(
        {
            "job_id": job_id,
            "status": status_name,
            "data_kind": row["data_kind"],
            "symbols": list(row["symbols"]),
            "bars_processed": row["bars_processed"],
            "failed_symbols": list(row["failed_symbols"]),
            "started_at": _iso(row["started_at"]),
            "completed_at": _iso(row["completed_at"]),
        }
    )
    return notify_pb2.FanoutWebhookRequest(
        callback_url=row["callback_url"],
        event_name=_EVENT_NAMES[row["status"]],
        payload=payload,
        idempotency_key=f"backfill:{job_id}:{status_name}",
    )


async def _emit_rejected_alert(servicer, job_id: str, reason: str, meta) -> None:
    ctx = Struct()
    ctx.update({"job_id": job_id, "reason": reason})
    try:
        await servicer._notify.EmitAlert(
            notify_pb2.EmitAlertRequest(
                severity=notify_pb2.ALERT_SEVERITY_WARNING,
                category="backfill",
                title=f"Backfill {job_id} webhook callback rejected",
                body=f"Backfill job {job_id}: no webhook will be sent ({reason})",
                source_service="xstockstrat-ingest",
                tags=[f"job_id:{job_id}"],
                context=ctx,
            ),
            metadata=meta,
        )
    except Exception as e:
        log.warning("failed to emit webhook-rejected alert for job %s: %s", job_id, e)


async def run_one_cycle(servicer) -> None:
    """One pass over the jobs awaiting hand-off, oldest first. Ends at the first failure that is
    not a URL rejection; the remaining jobs are retried on the next cycle."""
    if servicer._db is None or servicer._notify is None:
        return
    started = time.monotonic()
    rows = await backfill_jobs.list_webhook_handoff_candidates(
        servicer._db, terminal_statuses=list(_EVENT_NAMES), limit=_BATCH_SIZE
    )
    for row in rows:
        job_id = str(row["job_id"])
        meta = (("x-trace-id", str(uuid.uuid4())),)
        try:
            await servicer._notify.FanoutWebhook(
                _fanout_request(row, job_id), metadata=meta, timeout=_FANOUT_WEBHOOK_TIMEOUT_S
            )
        except grpc.aio.AioRpcError as e:
            if e.code() == grpc.StatusCode.INVALID_ARGUMENT:
                # Marker first: the alert is best-effort and must not make the job retry.
                if await backfill_jobs.mark_webhook_rejected(servicer._db, job_id):
                    await _emit_rejected_alert(servicer, job_id, e.details() or "", meta)
                continue
            if e.code() == grpc.StatusCode.PERMISSION_DENIED:
                log.error(
                    "webhook hand-off for job %s refused by notify's caller gate: %s",
                    job_id,
                    e.details(),
                )
            else:
                log.warning("webhook hand-off for job %s failed: %s", job_id, e.code().name)
            return
        except Exception as e:
            log.warning("webhook hand-off for job %s failed: %s", job_id, type(e).__name__)
            return
        await backfill_jobs.mark_webhook_enqueued(servicer._db, job_id)
    log_tick_ok(
        log,
        Loop.WEBHOOK_HANDOFF,
        (time.monotonic() - started) * 1000,
        state="idle" if not rows else None,
    )


async def run_webhook_handoff_loop(servicer, cfg_watcher) -> None:
    """Runs a cycle whenever a terminal write wakes it, and at least once per
    `backfill.webhook_sweep_interval_seconds`. Waits before its first cycle; never exits."""
    while True:
        interval = cfg_watcher.backfill_webhook_sweep_interval_seconds
        try:
            await asyncio.wait_for(servicer._webhook_wake.wait(), timeout=interval)
        except TimeoutError:
            pass
        servicer._webhook_wake.clear()
        try:
            await run_one_cycle(servicer)
        except Exception as e:
            log.warning("webhook hand-off cycle failed: %s", e)
