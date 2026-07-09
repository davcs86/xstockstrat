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
    result = await repo.upsert("strat-1", 0.82, "A", components)

    # SQL is an upsert on the primary key.
    sql = db_pool.fetchrow.call_args.args[0]
    assert "ON CONFLICT (strategy_id) DO UPDATE" in sql

    # The component-scores map is serialized to a JSON string for the ::jsonb bind,
    # not passed through as a dict.
    jsonb_arg = db_pool.fetchrow.call_args.args[4]
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
    await repo.upsert("s2", 0.1, "F", {})
    assert db_pool.fetchrow.call_args.args[4] == json.dumps({})


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
    row = await repo.get_by_id("s1")
    assert row["strategy_id"] == "s1"
    assert row["component_scores"] == {"sharpe": 0.9}
