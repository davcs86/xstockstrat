"""Unit tests for BacktestRunSymbolsRepository (feature 065 evidence cells).

Mirrors the AsyncMock-pool pattern from tests/test_backtest_runs_repo.py: the repo is
constructed with an ``AsyncMock`` pool whose ``executemany``/``fetch`` are stubbed, so the SQL
and the bind arguments are asserted without a live Postgres.
"""

from unittest.mock import AsyncMock

import pytest

from app.repositories.backtest_run_symbols import BacktestRunSymbolsRepository, _to_dict


def _cell(symbol="AAPL", trades=2, days=10, fp="fp-1"):
    return {
        "backtest_id": "bt-1",
        "strategy_id": "s1",
        "symbol": symbol,
        "sharpe_ratio": 1.5,
        "max_drawdown": 0.08,
        "win_rate": 0.6,
        "total_return": 0.12,
        "total_trades": trades,
        "trading_days": days,
        "definition_fingerprint": fp,
        "range_start": None,
        "range_end": None,
    }


@pytest.mark.asyncio
async def test_insert_many_builds_executemany_sql_and_params():
    db_pool = AsyncMock()
    db_pool.executemany = AsyncMock(return_value=None)
    repo = BacktestRunSymbolsRepository(db_pool)

    await repo.insert_many([_cell("AAPL"), _cell("MSFT", trades=0, days=5)])

    sql, rows = db_pool.executemany.call_args.args
    assert "INSERT INTO analysis.backtest_run_symbols" in sql
    assert "ON CONFLICT (backtest_id, symbol) DO NOTHING" in sql
    # completed_at is DB-defaulted (NOT in the column list) so all cells share a stamp.
    assert "completed_at" not in sql
    assert len(rows) == 2
    # Column order: id, strategy, symbol, sharpe, drawdown, win_rate, total_return,
    # total_trades, trading_days, fingerprint, range_start, range_end.
    aapl = rows[0]
    assert aapl[0] == "bt-1"
    assert aapl[2] == "AAPL"
    assert aapl[7] == 2  # total_trades
    assert aapl[8] == 10  # trading_days
    assert aapl[9] == "fp-1"  # definition_fingerprint
    assert rows[1][2] == "MSFT"
    assert rows[1][7] == 0  # zero-trade cell still inserted


@pytest.mark.asyncio
async def test_insert_many_empty_is_noop():
    db_pool = AsyncMock()
    db_pool.executemany = AsyncMock(return_value=None)
    repo = BacktestRunSymbolsRepository(db_pool)
    await repo.insert_many([])
    db_pool.executemany.assert_not_awaited()


@pytest.mark.asyncio
async def test_fetch_eligible_traded_first_distinct_on_sql():
    db_pool = AsyncMock()
    db_pool.fetch = AsyncMock(return_value=[{"symbol": "AAPL"}, {"symbol": "MSFT"}])
    repo = BacktestRunSymbolsRepository(db_pool)

    rows = await repo.fetch_eligible("s1", "fp-1")

    sql, *params = db_pool.fetch.call_args.args
    assert "DISTINCT ON (symbol)" in sql
    assert "definition_fingerprint = $2" in sql
    # traded-first dedup ordering: traded cells win, then most days, then newest.
    assert "(total_trades > 0) DESC" in sql
    assert "trading_days DESC" in sql
    assert "completed_at DESC" in sql
    assert params == ["s1", "fp-1"]
    assert [r["symbol"] for r in rows] == ["AAPL", "MSFT"]


def test_to_dict_none_row_is_none():
    assert _to_dict(None) is None


def test_to_dict_copies_row():
    row = {"backtest_id": "bt-1", "symbol": "AAPL"}
    d = _to_dict(row)
    assert d == row
    assert d is not row
