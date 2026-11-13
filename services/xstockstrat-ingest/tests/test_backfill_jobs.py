"""Unit tests for the backfill_jobs repository (feature 052).

The asyncpg pool is mocked, so these exercise SQL shape + parameter passing without a DB.
"""

from unittest.mock import AsyncMock

import pytest

from app.repositories import backfill_jobs
from tests._helpers import job_row


@pytest.mark.asyncio
async def test_insert_job_executes_insert():
    pool = AsyncMock()
    await backfill_jobs.insert_job(
        pool,
        job_id="j1",
        symbols=["AAPL", "TSLA"],
        timeframe="1d",
        range_start=None,
        range_end=None,
        status=1,
    )
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO ingest.backfill_jobs" in sql
    assert pool.execute.await_args.args[1] == "j1"


@pytest.mark.asyncio
async def test_update_job_builds_set_clause():
    pool = AsyncMock()
    await backfill_jobs.update_job(pool, "j1", status=3, bars_processed=42)
    sql = pool.execute.await_args.args[0]
    assert "status = $1" in sql
    assert "bars_processed = $2" in sql
    assert "WHERE job_id = $3::uuid" in sql
    # values then job_id
    assert pool.execute.await_args.args[1:] == (3, 42, "j1")


@pytest.mark.asyncio
async def test_update_job_noop_when_empty():
    pool = AsyncMock()
    await backfill_jobs.update_job(pool, "j1")
    pool.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_job_rejects_unknown_column():
    pool = AsyncMock()
    with pytest.raises(ValueError, match="non-updatable"):
        await backfill_jobs.update_job(pool, "j1", symbols=["X"])  # symbols not updatable
    pool.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_get_job_returns_dict_or_none():
    pool = AsyncMock()
    pool.fetchrow = AsyncMock(return_value={"job_id": "j1", "status": 2})
    row = await backfill_jobs.get_job(pool, "j1")
    assert row == {"job_id": "j1", "status": 2}

    pool.fetchrow = AsyncMock(return_value=None)
    assert await backfill_jobs.get_job(pool, "missing") is None


@pytest.mark.asyncio
async def test_list_jobs_with_and_without_filter():
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[{"job_id": "j1"}])

    await backfill_jobs.list_jobs(pool, status_filter=None, limit=10, offset=0)
    assert "WHERE status" not in pool.fetch.await_args.args[0]

    await backfill_jobs.list_jobs(pool, status_filter=3, limit=10, offset=5)
    assert "WHERE status = $1" in pool.fetch.await_args.args[0]
    assert pool.fetch.await_args.args[1] == 3


@pytest.mark.asyncio
async def test_reconcile_interrupted_returns_count():
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[{"job_id": "a"}, {"job_id": "b"}])
    n = await backfill_jobs.reconcile_interrupted(
        pool,
        failed_status=4,
        running_status=2,
        queued_status=1,
        error_msg="interrupted by restart",
    )
    assert n == 2
    sql = pool.fetch.await_args.args[0]
    assert "UPDATE ingest.backfill_jobs SET status = $1" in sql
    assert "WHERE status IN ($3, $4)" in sql
    # failed_status, error_msg, running_status, queued_status
    assert pool.fetch.await_args.args[1:] == (4, "interrupted by restart", 2, 1)


_CALLBACK_URL = "https://webhooks.ts.example.net:8443/hooks/h1"


async def _insert(pool, **over):
    await backfill_jobs.insert_job(
        pool,
        job_id="j1",
        symbols=["AAPL"],
        timeframe="1d",
        range_start=None,
        range_end=None,
        status=1,
        **over,
    )


@pytest.mark.asyncio
async def test_insert_job_binds_callback_url_as_eighth_value():
    """@AC-2 (feature 334): the callback URL is stored on the job row."""
    pool = AsyncMock()
    await _insert(pool, callback_url=_CALLBACK_URL)
    sql, *params = pool.execute.await_args.args
    assert "data_kind, callback_url)" in sql
    assert "$8" in sql
    assert len(params) == 8
    assert params[7] == _CALLBACK_URL


@pytest.mark.asyncio
async def test_insert_job_without_callback_url_binds_null():
    pool = AsyncMock()
    await _insert(pool)
    params = pool.execute.await_args.args[1:]
    assert len(params) == 8
    assert params[7] is None


@pytest.mark.asyncio
async def test_list_webhook_handoff_candidates_sql_and_params():
    """@AC-21 / @AC-29 (feature 334): only terminal jobs with a callback and no marker."""
    row = job_row("j1", 3, callback_url=_CALLBACK_URL)
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[row])
    rows = await backfill_jobs.list_webhook_handoff_candidates(
        pool, terminal_statuses=[3, 4, 5, 6], limit=50
    )
    assert rows == [row]
    sql, *params = pool.fetch.await_args.args
    assert "FROM ingest.backfill_jobs" in sql
    assert "callback_url IS NOT NULL" in sql
    assert "status = ANY($1::smallint[])" in sql
    assert "webhook_enqueued_at IS NULL" in sql
    assert "webhook_rejected_at IS NULL" in sql
    assert " OR " not in sql
    assert "ORDER BY completed_at, created_at" in sql
    assert "LIMIT $2" in sql
    assert params == [[3, 4, 5, 6], 50]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("fn_name", "marker"),
    [
        ("mark_webhook_enqueued", "webhook_enqueued_at"),
        ("mark_webhook_rejected", "webhook_rejected_at"),
    ],
)
async def test_webhook_marker_update_is_guarded_and_reports_change(fn_name, marker):
    fn = getattr(backfill_jobs, fn_name)
    pool = AsyncMock()
    pool.execute = AsyncMock(return_value="UPDATE 1")
    assert await fn(pool, "j1") is True
    sql, *params = pool.execute.await_args.args
    assert f"UPDATE ingest.backfill_jobs SET {marker} = NOW()" in sql
    assert "WHERE job_id = $1::uuid" in sql
    assert "AND webhook_enqueued_at IS NULL AND webhook_rejected_at IS NULL" in sql
    assert "status" not in sql
    assert params == ["j1"]

    pool.execute = AsyncMock(return_value="UPDATE 0")
    assert await fn(pool, "j1") is False


def test_webhook_columns_are_not_dynamically_updatable():
    """INGEST-2: the markers and the URL are written only by their dedicated static statements."""
    assert not {"callback_url", "webhook_enqueued_at", "webhook_rejected_at"} & set(
        backfill_jobs._UPDATABLE_COLUMNS
    )
