"""TemplateIntentsRepository — the ``analysis.template_intents`` saga log (feature 224).

States: PENDING → COMMITTED → FINALIZED, or PENDING → ABORTING → ABORTED. Every transition is a
compare-and-set on the current state, so the request path and the reconcile sweep never both win.
"""


class TemplateIntentsRepository:
    def __init__(self, db_pool):
        self._db = db_pool

    async def create(self, intent: dict) -> None:
        await self._db.execute(
            """
            INSERT INTO analysis.template_intents
                (intent_id, user_id, template_id, template_version, strategy_id, state)
            VALUES ($1::uuid, $2, $3, $4, $5, 'PENDING')
            """,
            intent["intent_id"],
            intent["user_id"],
            intent["template_id"],
            intent["template_version"],
            intent["strategy_id"],
        )

    async def cas(
        self, intent_id: str, from_state: str, to_state: str, conn=None, *, user_id=None
    ) -> bool:
        """Move ``from_state → to_state``; False when the row is in another state (or owner)."""
        db = conn if conn is not None else self._db
        status = await db.execute(
            """
            UPDATE analysis.template_intents
               SET state = $3, updated_at = NOW()
             WHERE intent_id = $1::uuid AND state = $2
               AND ($4::text IS NULL OR user_id = $4)
            """,
            intent_id,
            from_state,
            to_state,
            user_id,
        )
        return status.split()[-1] != "0"

    async def stale(self, states, older_than: float) -> list[dict]:
        rows = await self._db.fetch(
            """
            SELECT intent_id::text AS intent_id, user_id, template_id, template_version,
                   strategy_id, state
              FROM analysis.template_intents
             WHERE state = ANY($1::text[])
               AND updated_at <= NOW() - make_interval(secs => $2)
             ORDER BY updated_at
            """,
            list(states),
            float(older_than),
        )
        return [dict(r) for r in rows]
