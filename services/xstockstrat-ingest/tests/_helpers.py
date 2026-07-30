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
"""


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
