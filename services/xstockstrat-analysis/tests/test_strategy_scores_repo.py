"""Unit tests for StrategyScoresRepository (feature 064 — persist-strategy-scores).

Mirrors the AsyncMock-pool pattern from tests/test_fundsignal_loop.py: the repo is
constructed with an ``AsyncMock`` pool whose ``fetchrow``/``fetch`` are stubbed, so the
SQL and the JSONB serialization are asserted without a live Postgres.
"""

import json
from unittest.mock import AsyncMock

import pytest

from app.repositories.strategy_scores import StrategyScoresRepository, _to_dict


@pytest.mark.asyncio
async def test_upsert_uses_on_conflict_and_serializes_component_scores():
    db_pool = AsyncMock()
    db_pool.fetchrow = AsyncMock(
        return_value={
            "strategy_id": "strat-1",
            "overall_score": 0.82,
            "rating": "A",
            "component_scores": '{"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6}',
        }
    )
    repo = StrategyScoresRepository(db_pool)

    components = {"sharpe": 0.9, "drawdown": 0.7, "win_rate": 0.6}
    result = await repo.upsert("alice", "strat-1", 0.82, "A", components)

    # SQL is an upsert on the owner-keyed primary key (feature 224, strategy_scores_v2).
    sql = db_pool.fetchrow.call_args.args[0]
    assert "analysis.strategy_scores_v2" in sql
    assert "ON CONFLICT (user_id, strategy_id) DO UPDATE" in sql
    assert db_pool.fetchrow.call_args.args[1:3] == ("alice", "strat-1")

    # The component-scores map is serialized to a JSON string for the ::jsonb bind,
    # not passed through as a dict.
    jsonb_arg = db_pool.fetchrow.call_args.args[5]
    assert jsonb_arg == json.dumps(components)

    # The returned row has its JSONB decoded back to a dict.
    assert result["component_scores"] == components


@pytest.mark.asyncio
async def test_upsert_empty_component_scores_serializes_to_empty_object():
    db_pool = AsyncMock()
    db_pool.fetchrow = AsyncMock(
        return_value={
            "strategy_id": "s2",
            "overall_score": 0.1,
            "rating": "F",
            "component_scores": {},
        }
    )
    repo = StrategyScoresRepository(db_pool)
    await repo.upsert("alice", "s2", 0.1, "F", {})
    assert db_pool.fetchrow.call_args.args[5] == json.dumps({})


def test_to_dict_decodes_jsonb_string():
    row = {
        "strategy_id": "s1",
        "overall_score": 0.5,
        "rating": "C",
        "component_scores": '{"sharpe": 0.9}',
    }
    d = _to_dict(row)
    assert d["component_scores"] == {"sharpe": 0.9}


def test_to_dict_none_component_scores_becomes_empty_dict():
    row = {
        "strategy_id": "s1",
        "overall_score": 0.5,
        "rating": "C",
        "component_scores": None,
    }
    assert _to_dict(row)["component_scores"] == {}


def test_to_dict_none_row_is_none():
    assert _to_dict(None) is None


@pytest.mark.asyncio
async def test_list_decodes_every_row():
    db_pool = AsyncMock()
    db_pool.fetch = AsyncMock(
        return_value=[
            {
                "strategy_id": "s1",
                "overall_score": 0.8,
                "rating": "A",
                "component_scores": '{"sharpe": 0.9}',
            },
            {
                "strategy_id": "s2",
                "overall_score": 0.4,
                "rating": "D",
                "component_scores": None,
            },
        ]
    )
    repo = StrategyScoresRepository(db_pool)
    rows = await repo.list()
    assert "analysis.strategy_scores_v2" in db_pool.fetch.call_args.args[0]
    assert len(rows) == 2
    assert rows[0]["component_scores"] == {"sharpe": 0.9}
    assert rows[1]["component_scores"] == {}


@pytest.mark.asyncio
async def test_get_by_id_decodes_row():
    db_pool = AsyncMock()
    db_pool.fetchrow = AsyncMock(
        return_value={
            "strategy_id": "s1",
            "overall_score": 0.8,
            "rating": "A",
            "component_scores": '{"sharpe": 0.9}',
        }
    )
    repo = StrategyScoresRepository(db_pool)
    row = await repo.get_by_id("alice", "s1")
    sql, *params = db_pool.fetchrow.call_args.args
    assert "analysis.strategy_scores_v2" in sql
    assert "user_id = $1 AND strategy_id = $2" in sql
    assert params == ["alice", "s1"]
    assert row["strategy_id"] == "s1"
    assert row["component_scores"] == {"sharpe": 0.9}


@pytest.mark.asyncio
async def test_upsert_binds_provenance_columns():
    """feature 065: upsert also writes n_symbols / total_trading_days / provisional."""
    db_pool = AsyncMock()
    db_pool.fetchrow = AsyncMock(
        return_value={
            "strategy_id": "s1",
            "overall_score": 0.7,
            "rating": "B",
            "component_scores": {},
            "n_symbols": 4,
            "total_trading_days": 900,
            "provisional": True,
        }
    )
    repo = StrategyScoresRepository(db_pool)
    await repo.upsert(
        "alice",
        "s1",
        0.7,
        "B",
        {"sharpe": 0.5},
        n_symbols=4,
        total_trading_days=900,
        provisional=True,
    )
    sql = db_pool.fetchrow.call_args.args[0]
    assert "n_symbols" in sql
    assert "total_trading_days" in sql
    assert "provisional" in sql
    args = db_pool.fetchrow.call_args.args
    # Positional binds after the JSONB component_scores ($5): n_symbols, days, provisional.
    assert args[6] == 4
    assert args[7] == 900
    assert args[8] is True


@pytest.mark.asyncio
async def test_delete_issues_delete_sql():
    """feature 065: delete clears a strategy's materialized grade."""
    db_pool = AsyncMock()
    db_pool.execute = AsyncMock(return_value=None)
    repo = StrategyScoresRepository(db_pool)
    await repo.delete("alice", "s1")
    sql, uid, sid = db_pool.execute.call_args.args
    assert "DELETE FROM analysis.strategy_scores_v2" in sql
    assert "WHERE user_id = $1 AND strategy_id = $2" in sql
    assert (uid, sid) == ("alice", "s1")


@pytest.mark.asyncio
async def test_list_unscored_pairs_selects_ambiguous_owner_pairs_without_v2_row():
    """feature 224: boot recompute reads (user_id, strategy_id) pairs of ambiguous ids with no
    strategy_scores_v2 row, bounded by the caller's per-pass LIMIT."""
    db_pool = AsyncMock()
    db_pool.fetch = AsyncMock(return_value=[{"user_id": "alice", "strategy_id": "mr"}])
    repo = StrategyScoresRepository(db_pool)
    pairs = await repo.list_unscored_pairs(limit=50)
    sql, *params = db_pool.fetch.call_args.args
    assert "analysis.strategies" in sql
    assert "analysis.strategy_scores_v2" in sql
    assert "NOT EXISTS" in sql
    assert "HAVING count(*) > 1" in sql
    assert "LIMIT $1" in sql
    assert params == [50]
    assert pairs == [("alice", "mr")]
