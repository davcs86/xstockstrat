"""Repository for the durable ``ingest.backfill_jobs`` table (feature 052).

Module-level async functions in the same style as ``signal_sources.py`` — each takes
the asyncpg pool as the first argument and stays proto-free (the servicer maps rows to
``BackfillJob`` messages and passes ``BackfillStatus`` enum ints in for the status
columns). Replaces the former in-memory ``IngestServicer._jobs`` dict.
"""

from __future__ import annotations

# Columns the servicer is allowed to mutate via update_job(). Restricting the set keeps
# the dynamically-built SET clause safe (kwargs become column names).
_UPDATABLE_COLUMNS = frozenset(
    {
        "status",
        "bars_processed",
        "bars_total",
        "chunks_total",
        "chunks_completed",
        "failed_symbols",
        "error",
        "started_at",
        "completed_at",
    }
)


async def insert_job(
    db_pool,
    *,
    job_id: str,
    symbols: list[str],
    timeframe: str,
    range_start,
    range_end,
    status: int,
) -> None:
    """Insert a freshly-created job row (status is a BackfillStatus enum int)."""
    await db_pool.execute(
        "INSERT INTO ingest.backfill_jobs"
        " (job_id, symbols, timeframe, range_start, range_end, status)"
        " VALUES ($1::uuid, $2, $3, $4, $5, $6)",
        job_id,
        list(symbols),
        timeframe,
        range_start,
        range_end,
        status,
    )


async def update_job(db_pool, job_id: str, **fields) -> None:
    """Dynamically update the mutable columns of one job.

    Only keys in ``_UPDATABLE_COLUMNS`` are accepted; anything else raises ValueError
    so a typo can never inject SQL through the column name.
    """
    if not fields:
        return
    bad = set(fields) - _UPDATABLE_COLUMNS
    if bad:
        raise ValueError(f"update_job: non-updatable column(s) {sorted(bad)}")
    cols = list(fields.keys())
    set_clause = ", ".join(f"{col} = ${i + 1}" for i, col in enumerate(cols))
    params = list(fields.values())
    params.append(job_id)
    await db_pool.execute(
        f"UPDATE ingest.backfill_jobs SET {set_clause} WHERE job_id = ${len(cols) + 1}::uuid",
        *params,
    )


async def get_job(db_pool, job_id: str) -> dict | None:
    row = await db_pool.fetchrow(
        "SELECT * FROM ingest.backfill_jobs WHERE job_id = $1::uuid",
        job_id,
    )
    return dict(row) if row is not None else None


async def list_jobs(
    db_pool,
    *,
    status_filter: int | None = None,
    symbol_filter: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """List jobs newest-first, optionally narrowed by status and/or symbol.

    ``symbol_filter`` matches against the ``symbols`` text[] column via ``= ANY(symbols)``
    (FR-3). Predicates are combined; placeholder positions are assigned dynamically so the
    WHERE clause stays parameterized.
    """
    conds: list[str] = []
    params: list = []
    if status_filter is not None:
        params.append(status_filter)
        conds.append(f"status = ${len(params)}")
    if symbol_filter:
        params.append(symbol_filter)
        conds.append(f"${len(params)} = ANY(symbols)")
    where = f" WHERE {' AND '.join(conds)}" if conds else ""
    params.append(limit)
    limit_idx = len(params)
    params.append(offset)
    offset_idx = len(params)
    rows = await db_pool.fetch(
        f"SELECT * FROM ingest.backfill_jobs{where}"
        f" ORDER BY created_at DESC LIMIT ${limit_idx} OFFSET ${offset_idx}",
        *params,
    )
    return [dict(row) for row in rows]


async def reconcile_interrupted(
    db_pool,
    *,
    failed_status: int,
    running_status: int,
    queued_status: int,
    error_msg: str,
) -> int:
    """Mark jobs left RUNNING/QUEUED by a prior process as FAILED (FR-3).

    Status ints are passed in by the servicer so this module stays proto-free.
    Returns the count of reconciled rows.
    """
    rows = await db_pool.fetch(
        "UPDATE ingest.backfill_jobs SET status = $1, error = $2, completed_at = NOW()"
        " WHERE status IN ($3, $4) RETURNING job_id",
        failed_status,
        error_msg,
        running_status,
        queued_status,
    )
    return len(rows)
