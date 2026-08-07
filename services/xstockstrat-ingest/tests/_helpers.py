"""Shared test fixtures for the ingest suites.

`job_row` lives here rather than in either test module because **both**
`test_ingest_servicer.py` and `test_cancel_backfill.py` drive `job_row_to_proto`
read paths, and a `backfill_jobs` row fixture that drifts between them is exactly
how feature 080's defect stayed invisible: a fixture carrying a `timeframe_enum`
key the database can never produce (`migrations/003_backfill_jobs.up.sql` has no
such column) let the suite assert against a shape the real source never emits.

Only `job_row` is shared. The two servicer factories (`make_servicer` here vs
`_make_servicer` there) differ in name, signature and body and are *not*
duplicates — see feature 080 `design.md` § Rejected Alternatives.

`transaction_conn` (feature 111) is the first mock helper for an explicit asyncpg
`acquire()`/`transaction()` code path in this service — see `design.md` § Open Risks
(resolved mocking risk) for why this idiom is needed and the precedent it borrows from
(`services/xstockstrat-agent/tests/test_client.py`'s `_channel_cm`).
"""

from unittest.mock import AsyncMock, MagicMock


def transaction_conn(*, db_fetchrow_side_effect=None, conn_fetchrow_side_effect=None):
    """Build a mock `db` whose `.acquire()` yields a `conn` mock shaped for
    `IngestServicer.IngestSignal`'s transaction (`async with self._db.acquire() as conn,
    conn.transaction():`), plus the pool-level `db.fetchrow`/`db.execute` used outside the
    transaction — the pre-transaction source-registry check, the post-rollback existing-id
    lookup on a dedup hit, and the `mark_source_fed`/`mark_source_error`/
    `touch_source_last_seen` bookkeeping calls.

    Returns `(db, conn)` — assign `svc._db = db` and drive `conn.fetchrow`'s call args/count
    via the returned `conn` for assertions.
    """
    conn = MagicMock()
    conn.fetchrow = AsyncMock(side_effect=conn_fetchrow_side_effect or [])

    tx_cm = MagicMock()
    tx_cm.__aenter__ = AsyncMock(return_value=None)
    tx_cm.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx_cm)

    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=False)

    db = MagicMock()
    db.acquire = MagicMock(return_value=acquire_cm)
    db.fetchrow = AsyncMock(side_effect=db_fetchrow_side_effect or [])
    db.execute = AsyncMock(return_value=None)
    return db, conn


def job_row(job_id: str, status: int, **over) -> dict:
    """A backfill_jobs row dict as asyncpg would return it.

    The 15 keys are exactly the DDL columns: `get_job`/`list_jobs` are
    `SELECT *`, so the mapper's input keys are the table's columns and nothing
    else. Do not add a key the database cannot produce.
    """
    row = {
        "job_id": job_id,
        "symbols": ["AAPL"],
        "timeframe": "1d",
        "range_start": None,
        "range_end": None,
        "status": status,
        "bars_processed": 0,
        "bars_total": 0,
        "chunks_total": 0,
        "chunks_completed": 0,
        "failed_symbols": [],
        "error": "",
        "started_at": None,
        "completed_at": None,
        "created_at": None,
    }
    row.update(over)
    return row
