"""
OpportunitiesRepository — asyncpg persistence for analysis.opportunities (feature 097).

The materialized per-user opportunity queue: ``ListOpportunities`` becomes a pure LEFT JOIN
read of this table against ``opportunity_actions`` (migration 011 + 010), refreshed by lazy
compute-on-read + stale-while-revalidate + a daily pass. ``readiness_json`` carries
passing/total + the conviction ordinal + the per-leaf trace inline. Mirrors the fetch/execute
style of ``backtest_runs.py``; reuses the existing pool (F-06).

Enum-number contract (kept in sync with analysis.proto ``OpportunityAction``):
DISMISS=2, SNOOZE=1, TAKE=3 — a stored action of 0 (UNSPECIFIED) never occurs, so
``COALESCE(action, 0)`` is a safe "no disposition" sentinel in the read filter.
"""

import json

# analysis.proto OpportunityAction enum numbers (persisted in opportunity_actions.action).
_ACTION_SNOOZE = 1
_ACTION_DISMISS = 2
_ACTION_TAKE = 3


def _to_dict(row) -> dict:
    """asyncpg Record → plain dict, decoding the JSONB columns (asyncpg returns them as str)."""
    d = dict(row)
    for col in ("readiness_json", "provenance"):
        raw = d.get(col)
        if isinstance(raw, str):
            d[col] = json.loads(raw) if raw else ({} if col == "readiness_json" else [])
        elif raw is None:
            d[col] = {} if col == "readiness_json" else []
    return d


class OpportunitiesRepository:
    """Replace/read persistence for the ``analysis.opportunities`` materialized queue."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def replace_for_user(self, user_id: str, rows: list[dict]) -> None:
        """Transactionally replace ALL of a user's materialized rows (delete + bulk insert).

        A whole-user replace (not per-row upsert) is what makes a recompute authoritative:
        a candidate that dropped out of the Universe since the last compute is removed, not
        left stale. ``computed_at`` defaults to ``now()`` per row.
        """
        async with self._db.acquire() as conn, conn.transaction():
            await conn.execute("DELETE FROM analysis.opportunities WHERE user_id = $1", user_id)
            if not rows:
                return
            await conn.executemany(
                """
                INSERT INTO analysis.opportunities
                    (user_id, opportunity_key, symbol, strategy_id, action, conviction,
                     readiness_json, signal_axis, provenance, thesis, valid_until)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11)
                """,
                [
                    (
                        user_id,
                        r["opportunity_key"],
                        r["symbol"],
                        r.get("strategy_id", ""),
                        int(r["action"]),
                        float(r.get("conviction", 0.0)),
                        json.dumps(r.get("readiness_json", {})),
                        float(r.get("signal_axis", 0.0)),
                        json.dumps(r.get("provenance", [])),
                        r.get("thesis", ""),
                        r["valid_until"],
                    )
                    for r in rows
                ],
            )

    async def read(
        self,
        user_id: str,
        min_conviction: float,
        signal_rank_weight: float,
        *,
        include_expired: bool,
    ) -> list[dict]:
        """The queue read: LEFT JOIN ``opportunity_actions`` to drop DISMISS + active SNOOZE,
        ranked by ``(1-w)·conviction + w·signal_axis`` DESC (``w`` clamped to [0,1] — OR-G).

        ``include_expired=False`` filters ``valid_until > now()`` (the normal fresh read);
        ``include_expired=True`` serves stale rows (stale-while-revalidate). A TAKE disposition
        is intentionally *not* filtered — it stays visible and feeds the queue_share/taken
        reconciliation (FR-7).
        """
        w = min(max(signal_rank_weight, 0.0), 1.0)
        valid_clause = "" if include_expired else "AND o.valid_until > now()"
        rows = await self._db.fetch(
            f"""
            SELECT o.opportunity_key, o.symbol, o.strategy_id, o.action, o.conviction,
                   o.readiness_json, o.signal_axis, o.provenance, o.thesis, o.valid_until,
                   o.computed_at
            FROM analysis.opportunities o
            LEFT JOIN analysis.opportunity_actions a
              ON a.user_id = o.user_id AND a.opportunity_key = o.opportunity_key
            WHERE o.user_id = $1
              {valid_clause}
              AND o.conviction >= $2
              AND COALESCE(a.action, 0) <> $4
              AND NOT (
                    COALESCE(a.action, 0) = $5
                    AND a.snooze_until IS NOT NULL
                    AND a.snooze_until > now()
              )
            ORDER BY ((1 - $3) * o.conviction + $3 * o.signal_axis) DESC, o.conviction DESC
            """,
            user_id,
            min_conviction,
            w,
            _ACTION_DISMISS,
            _ACTION_SNOOZE,
        )
        return [_to_dict(r) for r in rows]

    async def count_for_user(self, user_id: str) -> int:
        """Total materialized rows for a user regardless of validity — distinguishes a
        never-materialized cold read (0) from an all-stale user (>0, serve-stale path)."""
        n = await self._db.fetchval(
            "SELECT COUNT(*) FROM analysis.opportunities WHERE user_id = $1", user_id
        )
        return int(n or 0)

    async def has_fresh(self, user_id: str) -> bool:
        """True when the user has at least one still-valid row (``valid_until > now()``)."""
        return bool(
            await self._db.fetchval(
                "SELECT EXISTS (SELECT 1 FROM analysis.opportunities "
                "WHERE user_id = $1 AND valid_until > now())",
                user_id,
            )
        )

    async def distinct_user_ids(self) -> list[str]:
        """The OR-E known-user set: every user that has ever materialized a queue or recorded a
        disposition (``opportunities`` ∪ ``opportunity_actions``). The daily refresh iterates it —
        analysis cannot enumerate all users (strategies are global, no owner column)."""
        rows = await self._db.fetch(
            """
            SELECT user_id FROM analysis.opportunities
            UNION
            SELECT user_id FROM analysis.opportunity_actions
            """
        )
        return [r["user_id"] for r in rows]

    async def queue_share(self, user_id: str, strategy_id: str) -> float:
        """Strategy's real share of the user's valid queue: attributed rows for this strategy /
        all attributed rows (``strategy_id <> ''``), zero-guarded. Unattributed rows are excluded
        from the denominator (feature 097, FR-7)."""
        if not strategy_id:
            return 0.0
        row = await self._db.fetchrow(
            """
            SELECT
              COUNT(*) FILTER (WHERE strategy_id = $2)  AS num,
              COUNT(*) FILTER (WHERE strategy_id <> '') AS denom
            FROM analysis.opportunities
            WHERE user_id = $1 AND valid_until > now()
            """,
            user_id,
            strategy_id,
        )
        denom = int(row["denom"] or 0)
        if denom == 0:
            return 0.0
        return float(int(row["num"] or 0)) / float(denom)

    async def taken_count(self, user_id: str, strategy_id: str) -> int:
        """Queue-derived TAKE count for a strategy: TAKE dispositions on that strategy's
        attributed opportunities (feature 097, FR-7). Reconciled against trading ``ListOrders``
        so the two "taken" sources read consistently."""
        if not strategy_id:
            return 0
        n = await self._db.fetchval(
            """
            SELECT COUNT(*)
            FROM analysis.opportunity_actions a
            JOIN analysis.opportunities o
              ON o.user_id = a.user_id AND o.opportunity_key = a.opportunity_key
            WHERE a.user_id = $1 AND o.strategy_id = $2 AND a.action = $3
            """,
            user_id,
            strategy_id,
            _ACTION_TAKE,
        )
        return int(n or 0)
