"""StrategyTemplatesRepository against a real PostgreSQL (``local_pg``): feature 269 AC-1, AC-2."""

import re
from pathlib import Path

import asyncpg
import pytest
from gen.common.v1 import common_pb2

from app.repositories.strategy_templates import StrategyTemplatesRepository

pytestmark = pytest.mark.real_pg

_MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"
_DDL_FILE = "026_owner_dimension_templates.up.sql"
# Ends at the first "\n);" — a lazy ")" would stop inside DEFAULT NOW().
_DDL_RE = re.compile(r"CREATE TABLE IF NOT EXISTS analysis\.strategy_templates \(.*?\n\);", re.S)


async def _pool(dsn, size, **kwargs):
    return await asyncpg.create_pool(
        dsn, min_size=size, max_size=size, statement_cache_size=0, **kwargs
    )


def _strategy_templates_ddl():
    touching = [
        p.name for p in _MIGRATIONS.glob("*.up.sql") if "strategy_templates" in p.read_text()
    ]
    assert touching == [_DDL_FILE]
    match = _DDL_RE.search((_MIGRATIONS / _DDL_FILE).read_text())
    assert match is not None
    return match.group(0)


def _meta(template_id, name, description):
    return common_pb2.TemplateMeta(template_id=template_id, name=name, description=description)


async def _repo(dsn):
    pool = await _pool(dsn, 2)
    await pool.execute("CREATE SCHEMA IF NOT EXISTS analysis")
    await pool.execute(_strategy_templates_ddl())
    return pool, StrategyTemplatesRepository(pool)


async def test_ac1_update_persists_name_description_payload(local_pg):
    pool, repo = await _repo(local_pg)
    try:
        await repo.create(_meta("rpg-update", "Old", "d1"), {"strategy_id": "a"}, "admin-1")
        row = await repo.update(_meta("rpg-update", "New", "d2"), {"strategy_id": "b"})
        for got in (row, await repo.get("rpg-update")):
            assert (got["name"], got["description"], got["version"]) == ("New", "d2", 2)
            assert got["payload"] == {"strategy_id": "b"}
    finally:
        await pool.close()


async def test_update_of_retired_template_returns_none(local_pg):
    pool, repo = await _repo(local_pg)
    try:
        await repo.create(_meta("rpg-retired", "R", "r"), {"strategy_id": "r"}, "admin-1")
        await repo.retire("rpg-retired")
        assert await repo.update(_meta("rpg-retired", "X", "x"), {"strategy_id": "x"}) is None
    finally:
        await pool.close()


async def test_ac2_second_retire_keeps_retired_at_and_stamps_updated_at(local_pg):
    pool, repo = await _repo(local_pg)
    try:
        await repo.create(_meta("rpg-retire", "T", "t"), {"strategy_id": "t"}, "admin-1")
        first = await repo.retire("rpg-retire")
        await pool.execute("SELECT pg_sleep(0.01)")
        second = await repo.retire("rpg-retire")
        assert second is not None
        assert second["retired_at"] == first["retired_at"]
        assert second["updated_at"] > first["updated_at"]
        assert second["updated_at"] > second["retired_at"]
    finally:
        await pool.close()
