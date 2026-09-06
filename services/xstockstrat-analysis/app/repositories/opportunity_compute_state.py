"""Feature 177 FR-3 — per-user empty-universe compute-state.

``ListOpportunities`` recomputes on every poll for a user whose universe legitimately yields zero
opportunities, because ``replace_for_user([])`` DELETEs without inserting and ``count_for_user``
stays 0 (recon.md:23). This table records a short ``valid_until`` window stamped whenever a compute
completes empty, so subsequent polls inside the window serve empty without a synchronous recompute
(a background self-heal still runs). A dedicated table — not an in-band ``opportunities`` sentinel —
because the sentinel is filtered by the ``read`` conviction floor and re-kicks every poll (design.md
§ Rejected Alternatives). Reuses the existing analysis pool (F-06).
"""


class OpportunityComputeStateRepository:
    def __init__(self, db_pool):
        self._db = db_pool

    async def get(self, user_id: str) -> dict | None:
        """Return ``{computed_at, valid_until}`` for the user, or None when never stamped."""
        row = await self._db.fetchrow(
            """
            SELECT computed_at, valid_until
              FROM analysis.opportunity_compute_state
             WHERE user_id = $1
            """,
            user_id,
        )
        return dict(row) if row is not None else None

    async def upsert(self, user_id: str, valid_until) -> None:
        """Literal upsert — both NOT NULL columns supplied (``computed_at`` via ``now()``); the
        empty-universe stamp advances ``valid_until`` on conflict."""
        await self._db.execute(
            """
            INSERT INTO analysis.opportunity_compute_state (user_id, computed_at, valid_until)
            VALUES ($1, now(), $2)
            ON CONFLICT (user_id) DO UPDATE SET
                computed_at = now(),
                valid_until = EXCLUDED.valid_until
            """,
            user_id,
            valid_until,
        )
