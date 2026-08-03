"""
OpportunityActionsRepository — asyncpg-backed persistence for analysis.opportunity_actions
(feature 097). One row per (user_id, opportunity_key): the user's persisted disposition
(snooze / dismiss / take) of a queued opportunity, keyed by the server-authoritative
opportunity_key. Read back by ListOpportunities to filter/annotate the materialized queue
(Step 12). Mirrors the fetchrow/fetch style of backtest_runs.py; reuses the existing pool.
"""


class OpportunityActionsRepository:
    """Upsert/read persistence for the ``analysis.opportunity_actions`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def upsert(
        self,
        *,
        user_id: str,
        opportunity_key: str,
        action: int,
        snooze_until=None,
    ) -> None:
        """Persist a user's disposition for one opportunity_key (SNOOZE/DISMISS/TAKE)."""
        await self._db.execute(
            """
            INSERT INTO analysis.opportunity_actions
                (user_id, opportunity_key, action, snooze_until)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, opportunity_key) DO UPDATE
                SET action = EXCLUDED.action,
                    snooze_until = EXCLUDED.snooze_until,
                    created_at = now()
            """,
            user_id,
            opportunity_key,
            action,
            snooze_until,
        )

    async def list_for_user(self, user_id: str) -> dict:
        """Return ``{opportunity_key: {"action": int, "snooze_until": datetime|None}}`` for a user.

        Consumed by the ListOpportunities read-path join (Step 12) to filter snoozed/dismissed rows.
        """
        rows = await self._db.fetch(
            """
            SELECT opportunity_key, action, snooze_until
            FROM analysis.opportunity_actions
            WHERE user_id = $1
            """,
            user_id,
        )
        return {
            r["opportunity_key"]: {"action": r["action"], "snooze_until": r["snooze_until"]}
            for r in rows
        }
