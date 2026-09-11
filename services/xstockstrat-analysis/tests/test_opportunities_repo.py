"""feature 185 FR-5 — OpportunitiesRepository.replace_symbols (heal-only UPDATE) unit coverage.

Mirrors the AsyncMock-pool pattern of the sibling repo tests (test_backtest_runs_repo.py): the
pool's ``acquire()``/``transaction()`` are async context managers and ``executemany`` is stubbed, so
the SQL text + binds are asserted without a real database. The servicer-level heal behavior
(heal-in-place, no-resurrection, success-only readiness cache) is covered in the servicer tests.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.repositories.opportunities import OpportunitiesRepository

pytestmark = pytest.mark.asyncio


def _mock_pool():
    """A pool whose ``acquire()`` and ``conn.transaction()`` are async context managers and whose
    ``conn.executemany`` records its call — enough to assert the SQL + binds of a transactional
    executemany without a real asyncpg connection."""
    conn = AsyncMock()
    conn.executemany = AsyncMock()
    tx = MagicMock()
    tx.__aenter__ = AsyncMock(return_value=None)
    tx.__aexit__ = AsyncMock(return_value=None)
    conn.transaction = MagicMock(return_value=tx)
    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=None)
    pool = MagicMock()
    pool.acquire = MagicMock(return_value=acquire_cm)
    return pool, conn


async def test_replace_symbols_issues_heal_only_update_with_binds():
    """The write is a transactional UPDATE (never INSERT), re-stamps computed_at, matches on
    (user_id, opportunity_key), and binds the mutable columns in order."""
    pool, conn = _mock_pool()
    repo = OpportunitiesRepository(pool)
    valid = datetime(2999, 1, 1, tzinfo=UTC)
    await repo.replace_symbols(
        "u1",
        [
            {
                "opportunity_key": "u1|AAPL|sx",
                "conviction": 0.8,
                "readiness_json": {"passing_conditions": 1, "total_conditions": 1},
                "signal_axis": 0.5,
                "provenance": ["watchlist"],
                "thesis": "t",
                "valid_until": valid,
            }
        ],
    )
    conn.executemany.assert_awaited_once()
    sql, params = conn.executemany.await_args.args
    assert "UPDATE analysis.opportunities" in sql
    assert "INSERT" not in sql  # heal-only — never resurrects a dropped row
    assert "computed_at = now()" in sql
    assert "WHERE user_id = $1 AND opportunity_key = $2" in sql
    (bind,) = params  # one row
    assert bind[0] == "u1"
    assert bind[1] == "u1|AAPL|sx"
    assert bind[2] == 0.8  # conviction
    assert bind[4] == 0.5  # signal_axis
    assert '"watchlist"' in bind[5]  # provenance JSON-dumped to jsonb
    assert bind[7] == valid


async def test_replace_symbols_empty_is_a_noop():
    """An empty heal set returns before acquiring a connection (no wasted transaction)."""
    pool, conn = _mock_pool()
    repo = OpportunitiesRepository(pool)
    await repo.replace_symbols("u1", [])
    conn.executemany.assert_not_awaited()
    pool.acquire.assert_not_called()
