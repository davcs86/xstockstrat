"""BacktestRunSymbolsRepository.latest_formula_fingerprint against a real PostgreSQL
(``local_pg``): feature 327 AC-3."""

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import asyncpg
import pytest

from app.repositories.backtest_run_symbols import BacktestRunSymbolsRepository

pytestmark = pytest.mark.real_pg

_MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
# Ends at the first "\n);" so the later backtest_runs/strategy_scores ALTERs in 007 are not run.
_CREATE_RE = re.compile(
    r"CREATE TABLE IF NOT EXISTS analysis\.backtest_run_symbols \(.*?\n\);", re.S
)
_USER_ID_RE = re.compile(
    r"ALTER TABLE analysis\.backtest_run_symbols ADD COLUMN IF NOT EXISTS user_id TEXT;"
)
_T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _ddl():
    create = _CREATE_RE.search((_MIGRATIONS / "007_backtest_run_symbols.up.sql").read_text())
    user_id = _USER_ID_RE.search((_MIGRATIONS / "026_owner_dimension_templates.up.sql").read_text())
    assert create is not None and user_id is not None
    return [create.group(0), user_id.group(0)]


async def _repo(dsn):
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=1, statement_cache_size=0)
    await pool.execute("CREATE SCHEMA IF NOT EXISTS analysis")
    for stmt in _ddl():
        await pool.execute(stmt)
    return pool, BacktestRunSymbolsRepository(pool)


async def _insert(pool, *, sid, fp, user="alice", age_days=0, bt=None):
    await pool.execute(
        "INSERT INTO analysis.backtest_run_symbols"
        " (backtest_id, strategy_id, symbol, trading_days, definition_fingerprint, user_id,"
        " completed_at) VALUES ($1, $2, 'AAPL', 10, $3, $4, $5)",
        bt or f"{sid}-{user}-{fp}-{age_days}",
        sid,
        fp,
        user,
        _T0 - timedelta(days=age_days),
    )


async def test_ac3_bare_pre_feature_cell_is_never_returned(local_pg):
    pool, repo = await _repo(local_pg)
    try:
        await _insert(pool, sid="rpg-bare", fp="h", age_days=0)
        await _insert(pool, sid="rpg-bare", fp="h.aaa", age_days=5)
        assert await repo.latest_formula_fingerprint("alice", "rpg-bare", "h") == "h.aaa"
    finally:
        await pool.close()


async def test_newest_composite_wins(local_pg):
    pool, repo = await _repo(local_pg)
    try:
        await _insert(pool, sid="rpg-newest", fp="h.aaa", age_days=3)
        await _insert(pool, sid="rpg-newest", fp="h.bbb", age_days=1)
        assert await repo.latest_formula_fingerprint("alice", "rpg-newest", "h") == "h.bbb"
    finally:
        await pool.close()


async def test_other_owner_strategy_hash_and_null_are_ignored(local_pg):
    pool, repo = await _repo(local_pg)
    try:
        await _insert(pool, sid="rpg-scope", fp="h.aaa", age_days=9)
        await _insert(pool, sid="rpg-scope", fp="h.zzz", user="bob", age_days=0)
        await _insert(pool, sid="rpg-scope-other", fp="h.yyy", age_days=0)
        await _insert(pool, sid="rpg-scope", fp="hh.ccc", age_days=0)
        await _insert(pool, sid="rpg-scope", fp=None, age_days=0, bt="rpg-scope-null")
        assert await repo.latest_formula_fingerprint("alice", "rpg-scope", "h") == "h.aaa"
    finally:
        await pool.close()


async def test_only_bare_cells_returns_none(local_pg):
    pool, repo = await _repo(local_pg)
    try:
        await _insert(pool, sid="rpg-none", fp="h", age_days=0)
        await _insert(pool, sid="rpg-none", fp="h", age_days=1)
        assert await repo.latest_formula_fingerprint("alice", "rpg-none", "h") is None
    finally:
        await pool.close()
