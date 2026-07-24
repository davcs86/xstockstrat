"""Unit tests for BacktestDetailsRepository (persisted full backtest results, feature 068).

Mirrors the AsyncMock-pool pattern from tests/test_backtest_runs_repo.py: the repo is
constructed with an ``AsyncMock`` pool whose ``execute``/``fetchrow`` are stubbed, so the
SQL and the bind arguments are asserted without a live Postgres.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app.repositories.backtest_details import BacktestDetailsRepository

_COMPLETED_AT = datetime(2026, 7, 21, 12, 0, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_insert_binds_columns_and_evicts():
    db_pool = AsyncMock()
    db_pool.execute = AsyncMock(return_value="INSERT 0 1")
    repo = BacktestDetailsRepository(db_pool)

    await repo.insert(
        backtest_id="bt-1",
        strategy_id="s1",
        completed_at=_COMPLETED_AT,
        result_pb=b"\x0a\x04bt-1",
        retention=20,
    )

    assert db_pool.execute.await_count == 2
    insert_args = db_pool.execute.await_args_list[0].args
    assert "INSERT INTO analysis.backtest_details" in insert_args[0]
    assert "ON CONFLICT (backtest_id) DO NOTHING" in insert_args[0]
    assert insert_args[1] == "bt-1"
    assert insert_args[2] == "s1"
    assert insert_args[3] == _COMPLETED_AT
    assert insert_args[4] == b"\x0a\x04bt-1"
    # Eviction runs after the insert: newest-N-per-strategy survive.
    evict_args = db_pool.execute.await_args_list[1].args
    assert "DELETE FROM analysis.backtest_details" in evict_args[0]
    assert "ORDER BY completed_at DESC" in evict_args[0]
    assert "LIMIT $2" in evict_args[0]
    assert evict_args[1] == "s1"
    assert evict_args[2] == 20


@pytest.mark.asyncio
async def test_get_returns_bytes():
    db_pool = AsyncMock()
    db_pool.fetchrow = AsyncMock(return_value={"result_pb": b"payload"})
    repo = BacktestDetailsRepository(db_pool)

    assert await repo.get("bt-1") == b"payload"
    args = db_pool.fetchrow.call_args.args
    assert "SELECT result_pb FROM analysis.backtest_details" in args[0]
    assert args[1] == "bt-1"


@pytest.mark.asyncio
async def test_get_returns_none_when_absent():
    db_pool = AsyncMock()
    db_pool.fetchrow = AsyncMock(return_value=None)
    repo = BacktestDetailsRepository(db_pool)

    assert await repo.get("bt-missing") is None
