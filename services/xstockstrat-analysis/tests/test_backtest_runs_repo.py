"""Unit tests for BacktestRunsRepository (durable backtest run history).

Mirrors the AsyncMock-pool pattern from tests/test_strategy_scores_repo.py: the repo is
constructed with an ``AsyncMock`` pool whose ``fetchrow``/``fetch`` are stubbed, so the SQL
and the bind arguments are asserted without a live Postgres.
"""

from unittest.mock import AsyncMock

import pytest

from app.repositories.backtest_runs import BacktestRunsRepository, _to_dict


def _metrics():
    return {
        "total_return": 0.12,
        "annualized_return": 0.1,
        "sharpe_ratio": 1.5,
        "max_drawdown": 0.08,
        "win_rate": 0.6,
        "total_trades": 4,
        "profit_factor": 1.3,
    }


@pytest.mark.asyncio
async def test_insert_binds_metrics_symbols_and_score():
    db_pool = AsyncMock()
    db_pool.fetchrow = AsyncMock(return_value={"backtest_id": "bt-1"})
    repo = BacktestRunsRepository(db_pool)

    await repo.insert(
        backtest_id="bt-1",
        strategy_id="s1",
        status="BACKTEST_STATUS_OK",
        metrics=_metrics(),
        symbols=["AAPL", "MSFT"],
        overall_score=0.72,
        rating="B",
    )

    args = db_pool.fetchrow.call_args.args
    sql = args[0]
    assert "INSERT INTO analysis.backtest_runs" in sql
    assert "ON CONFLICT (backtest_id) DO NOTHING" in sql
    # Positional binds: id, strategy, status, then the 7 metrics, symbols, score, rating.
    assert args[1] == "bt-1"
    assert args[2] == "s1"
    assert args[3] == "BACKTEST_STATUS_OK"
    assert args[4] == 0.12  # total_return
    assert args[11] == ["AAPL", "MSFT"]  # symbols
    assert args[12] == 0.72  # overall_score
    assert args[13] == "B"  # rating


@pytest.mark.asyncio
async def test_insert_allows_null_score_for_insufficient_run():
    db_pool = AsyncMock()
    db_pool.fetchrow = AsyncMock(return_value=None)
    repo = BacktestRunsRepository(db_pool)

    result = await repo.insert(
        backtest_id="bt-2",
        strategy_id="s1",
        status="BACKTEST_STATUS_INSUFFICIENT_DATA",
        metrics=_metrics(),
        symbols=[],
        overall_score=None,
        rating=None,
    )

    args = db_pool.fetchrow.call_args.args
    assert args[12] is None  # overall_score
    assert args[13] is None  # rating
    assert result is None  # ON CONFLICT DO NOTHING → no RETURNING row


@pytest.mark.asyncio
async def test_list_by_strategy_orders_and_limits():
    db_pool = AsyncMock()
    db_pool.fetch = AsyncMock(return_value=[{"backtest_id": "bt-2"}, {"backtest_id": "bt-1"}])
    repo = BacktestRunsRepository(db_pool)

    rows = await repo.list_by_strategy("s1", limit=5)

    sql = db_pool.fetch.call_args.args[0]
    assert "WHERE strategy_id = $1" in sql
    assert "ORDER BY completed_at DESC" in sql
    assert db_pool.fetch.call_args.args[1] == "s1"
    assert db_pool.fetch.call_args.args[2] == 5
    assert [r["backtest_id"] for r in rows] == ["bt-2", "bt-1"]


def test_to_dict_none_row_is_none():
    assert _to_dict(None) is None


def test_to_dict_copies_row():
    row = {"backtest_id": "bt-1", "symbols": ["AAPL"]}
    d = _to_dict(row)
    assert d == row
    assert d is not row  # a plain-dict copy, not the original Record
