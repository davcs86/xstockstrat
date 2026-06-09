"""Unit tests for the backfill_jobs repository (feature 052).

The asyncpg pool is mocked, so these exercise SQL shape + parameter passing without a DB.
"""

from unittest.mock import AsyncMock

import pytest

from app.repositories import backfill_jobs


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
