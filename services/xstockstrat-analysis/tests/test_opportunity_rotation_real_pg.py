"""Feature 366 repositories against a real PostgreSQL (the tests/conftest.py ``local_pg`` fixture):
epoch decode, cursor no-clobber (D-13), mixed computed_at binds (O-21), atomicity (D-2) and the
DB half of @AC-5. C-13: the row literal has one consumer (this module), so it stays inline.
"""

import pathlib
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from app.repositories.opportunities import OpportunitiesRepository
from app.repositories.opportunity_compute_state import OpportunityComputeStateRepository

pytestmark = pytest.mark.real_pg

_MIGRATIONS = pathlib.Path(__file__).resolve().parents[1] / "migrations"
_DDL = (
    "011_opportunities.up.sql",
    "023_opportunity_compute_state.up.sql",
    "024_opportunity_composite_score.up.sql",
    "025_opportunity_symbol_score.up.sql",
    "030_opportunity_compute_state_live_only_cursor.up.sql",
)
_FUTURE = datetime(2999, 1, 1, tzinfo=UTC)


async def _new_pool(dsn):
    return await asyncpg.create_pool(dsn, min_size=1, max_size=2, statement_cache_size=0)


@pytest.fixture
async def pool(local_pg):
    pool = await _new_pool(local_pg)
    await pool.execute("CREATE SCHEMA IF NOT EXISTS analysis")
    for name in _DDL:
        await pool.execute((_MIGRATIONS / name).read_text())
    try:
        yield pool
    finally:
        await pool.close()


@pytest.fixture
def user():
    return uuid.uuid4().hex


def _row(key, **extra):
    return {
        "opportunity_key": key,
        "symbol": "AAPL",
        "strategy_id": "squeeze_breakout_trend",
        "action": 1,
        "conviction": 0.7,
        "readiness_json": {"passing_conditions": 1, "total_conditions": 2},
        "signal_axis": 0.4,
        "provenance": ["live_strategy"],
        "thesis": "t",
        "valid_until": _FUTURE,
        **extra,
    }


async def _keys(pool, user):
    rows = await pool.fetch(
        "SELECT opportunity_key FROM analysis.opportunities WHERE user_id = $1 ORDER BY 1", user
    )
    return [r["opportunity_key"] for r in rows]


async def test_first_cursor_write_decodes_an_aware_expired_epoch(pool, user):
    state = OpportunityComputeStateRepository(pool)
    await state.write_cursor(user, "AAPL")
    got = await state.get(user)
    assert got["valid_until"] == datetime(1970, 1, 1, tzinfo=UTC)
    assert (datetime.now(UTC) < got["valid_until"]) is False
    assert got["live_only_cursor"] == "AAPL"


async def test_cursor_write_keeps_the_empty_gate_valid_until(pool, user):
    state = OpportunityComputeStateRepository(pool)
    await state.upsert(user, _FUTURE)
    await state.write_cursor(user, "MSFT")
    got = await state.get(user)
    assert got["valid_until"] == _FUTURE
    assert got["live_only_cursor"] == "MSFT"


async def test_empty_gate_upsert_keeps_the_cursor(pool, user):
    state = OpportunityComputeStateRepository(pool)
    await state.write_cursor(user, "MSFT")
    await state.upsert(user, _FUTURE)
    got = await state.get(user)
    assert got["valid_until"] == _FUTURE
    assert got["live_only_cursor"] == "MSFT"


async def test_replace_binds_none_and_datetime_computed_at_in_one_executemany(pool, user):
    stored = datetime(2026, 11, 20, 14, 30, tzinfo=UTC)
    before = await pool.fetchval("SELECT now()")
    await OpportunitiesRepository(pool).replace_for_user(
        user, [_row(f"{user}|fresh"), _row(f"{user}|carried", computed_at=stored)]
    )
    after = await pool.fetchval("SELECT now()")
    rows = await pool.fetch(
        "SELECT opportunity_key, computed_at FROM analysis.opportunities WHERE user_id = $1", user
    )
    got = {r["opportunity_key"]: r["computed_at"] for r in rows}
    assert before <= got[f"{user}|fresh"] <= after
    assert got[f"{user}|carried"] == stored


async def test_failed_transaction_rolls_back_rows_and_cursor_together(pool, user):
    opps = OpportunitiesRepository(pool)
    state = OpportunityComputeStateRepository(pool)
    await opps.replace_for_user(user, [_row(f"{user}|old")])
    await state.write_cursor(user, "AAPL")

    with pytest.raises(RuntimeError):
        async with opps.transaction() as conn:
            await opps.replace_for_user(user, [_row(f"{user}|new")], conn=conn)
            await state.write_cursor(user, "MSFT", conn=conn)
            raise RuntimeError("compute failed after the writes")

    assert await _keys(pool, user) == [f"{user}|old"]
    assert (await state.get(user))["live_only_cursor"] == "AAPL"


async def test_committed_cursor_and_carried_row_survive_a_new_pool(pool, local_pg, user):
    carried_at = datetime.now(UTC) - timedelta(days=1)
    opps = OpportunitiesRepository(pool)
    async with opps.transaction() as conn:
        await opps.replace_for_user(user, [_row(f"{user}|c", computed_at=carried_at)], conn=conn)
        await OpportunityComputeStateRepository(pool).write_cursor(user, "NVDA", conn=conn)

    restarted = await _new_pool(local_pg)
    try:
        state = await OpportunityComputeStateRepository(restarted).get(user)
        rows = await OpportunitiesRepository(restarted).read_attributed_rows(user)
    finally:
        await restarted.close()
    assert state["live_only_cursor"] == "NVDA"
    (row,) = rows
    assert row["computed_at"] == carried_at
    assert row["valid_until"] == _FUTURE
    assert row["provenance"] == ["live_strategy"]
    assert row["readiness_json"] == {"passing_conditions": 1, "total_conditions": 2}
