"""Repository + planner for ``ingest.backfill_chunks`` (feature 054).

Module-level async functions in the ``signal_sources.py`` style (pool as first arg,
proto-free). ``plan_chunks`` is a pure function so it is unit-testable and drives
density-aware chunk sizing (FR-1). Chunk ``status`` columns use BackfillStatus enum
ordinals passed in by the servicer (0=UNSPECIFIED is treated as PENDING).
"""

from __future__ import annotations

from datetime import datetime, timedelta

# Approximate bars per trading day per symbol, keyed by canonical timeframe. Mirrors the
# marketdata estimate + the runbook Timeframe Guide.
_BARS_PER_DAY = {"1m": 390, "5m": 78, "1h": 7, "1d": 1}

# Chunk status ordinals (mirror BackfillStatus): PENDING reuses QUEUED(1) semantics here.
CHUNK_PENDING = 1
CHUNK_RUNNING = 2
CHUNK_COMPLETED = 3
CHUNK_FAILED = 4


def _weekdays(start: datetime, end: datetime) -> int:
    """Count weekdays (Mon–Fri) in [start, end). Trading-day approximation (no holidays)."""
    days = 0
    cur = start
    while cur < end:
        if cur.weekday() < 5:
            days += 1
        cur += timedelta(days=1)
    return days


def plan_chunks(
    symbols: list[str],
    timeframe: str,
    range_start: datetime,
    range_end: datetime,
    window_days: int,
    max_bars: int,
) -> list[dict]:
    """Split a backfill into chunks bounded by time window and a per-chunk bar cap.

    Primary split is by ``window_days``; within each window, symbols are batched so the
    estimated bar count never exceeds ``max_bars`` (density-driven: a 1m range yields more,
    smaller chunks than the same range at 1d). Pure function — returns chunk descriptors.
    """
    if not symbols or range_end <= range_start:
        return []
    window_days = max(1, window_days)
    max_bars = max(1, max_bars)
    bpd = _BARS_PER_DAY.get(timeframe, 1)

    chunks: list[dict] = []
    window = timedelta(days=window_days)
    cur = range_start
    while cur < range_end:
        wend = min(cur + window, range_end)
        bars_per_symbol = max(1, _weekdays(cur, wend) * bpd)
        max_syms = max(1, max_bars // bars_per_symbol)
        for i in range(0, len(symbols), max_syms):
            chunks.append(
                {
                    "symbols": symbols[i : i + max_syms],
                    "range_start": cur,
                    "range_end": wend,
                }
            )
        cur = wend
    return chunks


async def insert_chunks(db_pool, job_id: str, chunks: list[dict]) -> list[str]:
    """Bulk-insert planned chunks as PENDING. Returns the created chunk_ids (uuid strings)."""
    chunk_ids: list[str] = []
    for c in chunks:
        row = await db_pool.fetchrow(
            "INSERT INTO ingest.backfill_chunks"
            " (job_id, symbols, range_start, range_end, status)"
            " VALUES ($1::uuid, $2, $3, $4, $5) RETURNING chunk_id",
            job_id,
            list(c["symbols"]),
            c["range_start"],
            c["range_end"],
            CHUNK_PENDING,
        )
        chunk_ids.append(str(row["chunk_id"]))
    return chunk_ids


async def get_incomplete_chunks(db_pool, job_id: str) -> list[dict]:
    """Return PENDING/FAILED chunks for a job (uses the (job_id, status) index)."""
    rows = await db_pool.fetch(
        "SELECT * FROM ingest.backfill_chunks"
        " WHERE job_id = $1::uuid AND status IN ($2, $3) ORDER BY range_start",
        job_id,
        CHUNK_PENDING,
        CHUNK_FAILED,
    )
    return [dict(r) for r in rows]


async def mark_chunk_running(db_pool, chunk_id: str) -> None:
    await db_pool.execute(
        "UPDATE ingest.backfill_chunks"
        " SET status = $1, attempt_count = attempt_count + 1, started_at = NOW()"
        " WHERE chunk_id = $2::uuid",
        CHUNK_RUNNING,
        chunk_id,
    )


async def mark_chunk_completed(db_pool, chunk_id: str, *, bars_written: int) -> None:
    await db_pool.execute(
        "UPDATE ingest.backfill_chunks"
        " SET status = $1, bars_written = $2, completed_at = NOW() WHERE chunk_id = $3::uuid",
        CHUNK_COMPLETED,
        bars_written,
        chunk_id,
    )


async def mark_chunk_failed(db_pool, chunk_id: str, *, error: str) -> None:
    await db_pool.execute(
        "UPDATE ingest.backfill_chunks"
        " SET status = $1, error = $2, completed_at = NOW() WHERE chunk_id = $3::uuid",
        CHUNK_FAILED,
        error,
        chunk_id,
    )


async def list_jobs_with_incomplete_chunks(db_pool) -> list[str]:
    """Distinct job_ids that still have PENDING/FAILED chunks — drives resume-on-startup."""
    rows = await db_pool.fetch(
        "SELECT DISTINCT job_id FROM ingest.backfill_chunks WHERE status IN ($1, $2)",
        CHUNK_PENDING,
        CHUNK_FAILED,
    )
    return [str(r["job_id"]) for r in rows]
