"""
StrategiesRepository — asyncpg-backed persistence for analysis.strategies.

Mirrors the DB-query style of
services/xstockstrat-indicators/app/services/formulas_repository.py
(fetchrow / fetch / fetchval / execute). The whole composable StrategyDefinition is
stored as a single JSONB column (``definition_json``); callers always work with a plain
``dict``. ``strategy_id`` is a user-supplied TEXT primary key (lowercase/underscore).

Feature 133: the row identity is the composite ``(user_id, strategy_id)``. Ownership-scoped
callers resolve rows via :meth:`get_by_owner_and_id` and pass ``user_id`` into every write so the
``WHERE`` clause is owner-scoped at the SQL layer (not just an RPC-level pre-check).
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

    async def create(self, user_id, strategy_id, display_name, definition_json: dict) -> dict:
        row = await self._db.fetchrow(
            """
            INSERT INTO analysis.strategies
                (user_id, strategy_id, display_name, definition_json)
            VALUES ($1, $2, $3, $4::jsonb)
            RETURNING *
            """,
            user_id,
            strategy_id,
            display_name,
            json.dumps(dict(definition_json) if definition_json else {}),
        )
        return _to_dict(row)

    async def get_by_id(self, strategy_id: str) -> dict | None:
        """Owner-agnostic lookup. Retained for callers that legitimately already hold the row's
        owner (e.g. the live loop reads whole rows that carry ``user_id``). Ownership-scoped RPCs
        must use :meth:`get_by_owner_and_id` instead so a non-owner can never resolve the row."""
        row = await self._db.fetchrow(
            "SELECT * FROM analysis.strategies WHERE strategy_id = $1",
            strategy_id,
        )
        return _to_dict(row)

    async def get_by_owner_and_id(self, user_id: str, strategy_id: str) -> dict | None:
        """Owner-scoped twin of :meth:`get_by_id` — resolves the row only under its owner
        (feature 133). Returns ``None`` both when the id does not exist and when it exists under a
        different owner, so the servicer can answer both with a uniform ``PERMISSION_DENIED``."""
        row = await self._db.fetchrow(
            "SELECT * FROM analysis.strategies WHERE user_id = $1 AND strategy_id = $2",
            user_id,
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

    async def update_locked(self, user_id: str, strategy_id: str, apply_fn) -> dict | None:
        """Read-modify-write the definition under ``SELECT … FOR UPDATE`` (feature 070).

        The partial-merge path has to read the stored definition, merge the caller's masked
        fields into it, and write the result — three statements where the pre-070 full replace
        was one. Without a lock that is a lost-update window: a concurrent UI edit and agent
        tune would each merge onto the same base and the later write would silently discard the
        earlier one. ``_lock_for`` cannot help — it is documented single-process protection only.

        Feature 133: both the ``FOR UPDATE`` read and the write are scoped by ``user_id`` so the
        RMW can never touch another owner's row that happens to share ``strategy_id``.

        ``apply_fn(current_row) -> (display_name, definition_json)`` runs **inside** the
        transaction with the row locked. It must not perform I/O of its own: callers pre-fetch
        anything they need (e.g. formula outputs) before calling. Raising from ``apply_fn``
        rolls the transaction back and leaves the row untouched.

        Returns the updated row, or ``None`` if the strategy does not exist under this owner.
        """
        async with self._db.acquire() as conn, conn.transaction():
            row = await conn.fetchrow(
                "SELECT * FROM analysis.strategies "
                "WHERE strategy_id = $1 AND user_id = $2 FOR UPDATE",
                strategy_id,
                user_id,
            )
            if row is None:
                return None

            display_name, definition_json = await apply_fn(_to_dict(row))

            updated = await conn.fetchrow(
                """
                UPDATE analysis.strategies
                   SET display_name = $2, definition_json = $3::jsonb, updated_at = NOW()
                 WHERE strategy_id = $1 AND user_id = $4
                RETURNING *
                """,
                strategy_id,
                display_name,
                json.dumps(dict(definition_json) if definition_json else {}),
                user_id,
            )
            return _to_dict(updated)

    async def set_live_enabled(
        self, user_id: str, strategy_id: str, live_enabled: bool
    ) -> dict | None:
        row = await self._db.fetchrow(
            """
            UPDATE analysis.strategies
               SET live_enabled = $2, updated_at = NOW()
             WHERE strategy_id = $1 AND user_id = $3
            RETURNING *
            """,
            strategy_id,
            live_enabled,
            user_id,
        )
        return _to_dict(row)

    async def deactivate(self, user_id: str, strategy_id: str) -> dict | None:
        row = await self._db.fetchrow(
            """
            UPDATE analysis.strategies
               SET active = FALSE, updated_at = NOW()
             WHERE strategy_id = $1 AND user_id = $2
            RETURNING *
            """,
            strategy_id,
            user_id,
        )
        return _to_dict(row)

    async def reactivate(self, user_id: str, strategy_id: str) -> dict | None:
        """Feature 089: set active = TRUE (reactivation decoupled from update). None if missing
        under this owner (feature 133)."""
        row = await self._db.fetchrow(
            """
            UPDATE analysis.strategies
               SET active = TRUE, updated_at = NOW()
             WHERE strategy_id = $1 AND user_id = $2
            RETURNING *
            """,
            strategy_id,
            user_id,
        )
        return _to_dict(row)

    async def list(
        self,
        user_id: str,
        include_inactive: bool = False,
        page_size: int = 0,
        page_offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Owner-scoped list (feature 133): only the caller's own strategies. ``user_id`` is
        header-derived by the servicer, never read from the request body."""
        where = "WHERE user_id = $1"
        if not include_inactive:
            where += " AND active = TRUE"
        total = await self._db.fetchval(
            f"SELECT COUNT(*) FROM analysis.strategies {where}", user_id
        )
        sql = f"SELECT * FROM analysis.strategies {where} ORDER BY created_at DESC"
        params: list = [user_id]
        if page_size and page_size > 0:
            sql += " LIMIT $2 OFFSET $3"
            params.extend([page_size, page_offset or 0])
        rows = await self._db.fetch(sql, *params)
        return [_to_dict(r) for r in rows], int(total or 0)
