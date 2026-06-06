"""
StrategiesRepository — asyncpg-backed persistence for analysis.strategies.

Mirrors the DB-query style of
services/xstockstrat-indicators/app/services/formulas_repository.py
(fetchrow / fetch / fetchval / execute). The whole composable StrategyDefinition is
stored as a single JSONB column (``definition_json``); callers always work with a plain
``dict``. ``strategy_id`` is a user-supplied TEXT primary key (lowercase/underscore).
"""

import json


def _to_dict(row) -> dict | None:
    """Convert an asyncpg Record to a plain dict, decoding the JSONB definition_json."""
    if row is None:
        return None
    d = dict(row)
    raw = d.get("definition_json")
    if isinstance(raw, str):
        d["definition_json"] = json.loads(raw) if raw else {}
    elif raw is None:
        d["definition_json"] = {}
    return d


class StrategiesRepository:
    """CRUD persistence for the ``analysis.strategies`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def create(self, strategy_id, display_name, definition_json: dict) -> dict:
        row = await self._db.fetchrow(
            """
            INSERT INTO analysis.strategies
                (strategy_id, display_name, definition_json)
            VALUES ($1, $2, $3::jsonb)
            RETURNING *
            """,
            strategy_id,
            display_name,
            json.dumps(dict(definition_json) if definition_json else {}),
        )
        return _to_dict(row)

    async def get_by_id(self, strategy_id: str) -> dict | None:
        row = await self._db.fetchrow(
            "SELECT * FROM analysis.strategies WHERE strategy_id = $1",
            strategy_id,
        )
        return _to_dict(row)

    async def update(
        self, strategy_id: str, display_name: str, definition_json: dict
    ) -> dict | None:
        row = await self._db.fetchrow(
            """
            UPDATE analysis.strategies
               SET display_name = $2, definition_json = $3::jsonb, updated_at = NOW()
             WHERE strategy_id = $1
            RETURNING *
            """,
            strategy_id,
            display_name,
            json.dumps(dict(definition_json) if definition_json else {}),
        )
        return _to_dict(row)

    async def deactivate(self, strategy_id: str) -> dict | None:
        row = await self._db.fetchrow(
            """
            UPDATE analysis.strategies
               SET active = FALSE, updated_at = NOW()
             WHERE strategy_id = $1
            RETURNING *
            """,
            strategy_id,
        )
        return _to_dict(row)

    async def list(
        self,
        include_inactive: bool = False,
        page_size: int = 0,
        page_offset: int = 0,
    ) -> tuple[list[dict], int]:
        where = "" if include_inactive else "WHERE active = TRUE"
        total = await self._db.fetchval(f"SELECT COUNT(*) FROM analysis.strategies {where}")
        sql = f"SELECT * FROM analysis.strategies {where} ORDER BY created_at DESC"
        params: list = []
        if page_size and page_size > 0:
            sql += " LIMIT $1 OFFSET $2"
            params.extend([page_size, page_offset or 0])
        rows = await self._db.fetch(sql, *params)
        return [_to_dict(r) for r in rows], int(total or 0)
