"""Unit tests for StrategyCooldownsRepository (feature 116 — exit-cooldown, dual-purpose table).

Mirrors the AsyncMock-pool pattern from tests/test_strategy_scores_repo.py: the repo is
constructed with an ``AsyncMock`` pool whose ``execute``/``fetch`` are stubbed, so the SQL and
bind args are asserted without a live Postgres.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest

from app.repositories.strategy_cooldowns import StrategyCooldownsRepository


@pytest.mark.asyncio
async def test_upsert_exit_uses_on_conflict_and_targets_last_exit_at():
    db_pool = AsyncMock()
    db_pool.execute = AsyncMock()
    repo = StrategyCooldownsRepository(db_pool)

    ts = datetime(2026, 8, 1, tzinfo=UTC)
    await repo.upsert_exit("s1", "AAPL", ts)

    sql = db_pool.execute.call_args.args[0]
    assert "ON CONFLICT (strategy_id, symbol) DO UPDATE SET" in sql
    assert "last_exit_at = EXCLUDED.last_exit_at" in sql
    assert db_pool.execute.call_args.args[1:] == ("s1", "AAPL", ts)


@pytest.mark.asyncio
async def test_upsert_entry_uses_on_conflict_and_targets_last_entry_at():
    db_pool = AsyncMock()
    db_pool.execute = AsyncMock()
    repo = StrategyCooldownsRepository(db_pool)

    ts = datetime(2026, 8, 1, tzinfo=UTC)
    await repo.upsert_entry("s1", "AAPL", ts)

    sql = db_pool.execute.call_args.args[0]
    assert "ON CONFLICT (strategy_id, symbol) DO UPDATE SET" in sql
    assert "last_entry_at = EXCLUDED.last_entry_at" in sql
    assert db_pool.execute.call_args.args[1:] == ("s1", "AAPL", ts)


@pytest.mark.asyncio
async def test_list_all_returns_both_timestamps():
    db_pool = AsyncMock()
    exit_ts = datetime(2026, 7, 1, tzinfo=UTC)
    entry_ts = datetime(2026, 7, 15, tzinfo=UTC)
    db_pool.fetch = AsyncMock(
        return_value=[
            {
                "strategy_id": "s1",
                "symbol": "AAPL",
                "last_exit_at": exit_ts,
                "last_entry_at": entry_ts,
            }
        ]
    )
    repo = StrategyCooldownsRepository(db_pool)

    rows = await repo.list_all()

    assert len(rows) == 1
    assert rows[0]["last_exit_at"] == exit_ts
    assert rows[0]["last_entry_at"] == entry_ts
