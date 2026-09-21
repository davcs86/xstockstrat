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

# feature 190 — structural provenance markers that are NOT signal sources. The single canonical
# skip-set for BOTH the primary-source derivation (servicer._primary_source) and the source filter /
# facet below, bound as a `text[]` param so the SQL and Python can never drift. "unavailable" is
# deliberately absent (parity with _primary_source: an unavailable-led row surfaces "unavailable").
_PROVENANCE_STRUCTURAL_MARKERS = ["watchlist", "position", "denied"]

# feature 190 — the sort-key → ORDER BY fragment map (OpportunitySort enum ints). Selected by a
# constant key, never interpolated from user input (same safety class as the valid_clause f-string).
# UNSPECIFIED(0) = the legacy feature-187 blended rank (unchanged default for non-UI callers);
# CONVICTION(1) = raw o.conviction; EXPIRY(2) = soonest valid_until first. All three keep the
# symbol-partition group key + the o.opportunity_key ASC paging tiebreak (feature-185 @AC-8/@AC-9).
_SORT_ORDER_BY = {
    0: (
        "MAX(((1 - $3) * o.conviction + $3 * o.signal_axis)) OVER (PARTITION BY o.symbol) DESC, "
        "o.symbol ASC, ((1 - $3) * o.conviction + $3 * o.signal_axis) DESC, "
        "o.conviction DESC, o.opportunity_key ASC"
    ),
    1: (
        "MAX(o.conviction) OVER (PARTITION BY o.symbol) DESC, "
        "o.symbol ASC, o.conviction DESC, o.opportunity_key ASC"
    ),
    2: (
        "MIN(o.valid_until) OVER (PARTITION BY o.symbol) ASC NULLS LAST, "
        "o.symbol ASC, o.opportunity_key ASC"
    ),
}


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

    async def replace_symbols(self, user_id: str, rows: list[dict]) -> None:
        """Heal-only UPDATE-in-place of specific materialized rows (feature 185 FR-5 surgical
        recovery). For each row (keyed by ``opportunity_key``) UPDATE conviction/readiness_json/
        signal_axis/provenance/thesis/valid_until and re-stamp ``computed_at = now()``.

        It **never INSERTs** — a ``(user_id, opportunity_key)`` absent from the table is silently
        skipped (the UPDATE matches zero rows). This honors the whole-user-replace authoritative
        drop invariant to the degree a partial refresh can: a candidate that dropped out of the
        Universe is never resurrected here; membership reconciles at the next daily full compute.
        One transaction. Re-stamping ``computed_at`` for a still-unavailable scanned row is
        intentional — it holds the FR-5 retry cooldown so a persistently-down symbol does not
        re-kick every poll.
        """
        if not rows:
            return
        async with self._db.acquire() as conn, conn.transaction():
            await conn.executemany(
                """
                UPDATE analysis.opportunities
                   SET conviction = $3,
                       readiness_json = $4::jsonb,
                       signal_axis = $5,
                       provenance = $6::jsonb,
                       thesis = $7,
                       valid_until = $8,
                       computed_at = now()
                 WHERE user_id = $1 AND opportunity_key = $2
                """,
                [
                    (
                        user_id,
                        r["opportunity_key"],
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
        sources: list[str] | None = None,
        action_filter: int = 0,
        sort: int = 0,
    ) -> list[dict]:
        """The queue read: LEFT JOIN ``opportunity_actions`` to drop DISMISS + active SNOOZE.

        ``include_expired=False`` filters ``valid_until > now()`` (the normal fresh read);
        ``include_expired=True`` serves stale rows (stale-while-revalidate). A TAKE disposition
        is intentionally *not* filtered — it stays visible and feeds the queue_share/taken
        reconciliation (FR-7).

        feature 190 — server-side filters/sort (all default to a no-op so non-``ListOpportunities``
        callers, e.g. ``_retry_unavailable_symbols``, are unchanged):
        ``sources`` (empty = all; matched against the derived primary source, the
        ``_PROVENANCE_STRUCTURAL_MARKERS``-skipping first provenance token), ``action_filter``
        (``OpportunityActionTag`` int; 0 = any) applied to ``o.action``, and ``sort``
        (``OpportunitySort`` int; 0 = legacy blended rank). The min-conviction floor stays the SOLE
        floor with the muted/denied + unavailable exemption; source/action filters are NOT exempt.
        """
        w = min(max(signal_rank_weight, 0.0), 1.0)
        srcs = sources or []
        valid_clause = "" if include_expired else "AND o.valid_until > now()"
        order_by = _SORT_ORDER_BY.get(sort, _SORT_ORDER_BY[0])
        rows = await self._db.fetch(
            f"""
            SELECT o.opportunity_key, o.symbol, o.strategy_id, o.action, o.conviction,
                   o.readiness_json, o.signal_axis, o.provenance, o.thesis, o.valid_until,
                   o.computed_at
            FROM analysis.opportunities o
            LEFT JOIN analysis.opportunity_actions a
              ON a.user_id = o.user_id AND a.opportunity_key = o.opportunity_key
            -- feature 190: derive the primary source once per row (skip structural markers, bound
            -- as $6 = _PROVENANCE_STRUCTURAL_MARKERS). LEFT JOIN + LIMIT 1 keeps cardinality.
            LEFT JOIN LATERAL (
              SELECT elem FROM jsonb_array_elements_text(o.provenance) WITH ORDINALITY t(elem, ord)
              WHERE elem <> ALL($6::text[]) ORDER BY ord LIMIT 1
            ) ps ON true
            WHERE o.user_id = $1
              -- feature 190 fix: $3 (signal_rank_weight) is referenced ONLY by the sort=0 blended
              -- ORDER BY; a CONVICTION/EXPIRY sort omits it, so PREPARE can't infer its type
              -- (asyncpg IndeterminateDatatypeError). Anchor the type here (always true for w).
              AND $3::double precision IS NOT NULL
              {valid_clause}
              -- feature 132: a min_conviction floor must still return muted (deny-listed) rows,
              -- which carry conviction 0 by design (the mute is the signal, not a low score).
              -- feature 185: likewise return data-unavailable rows (conviction 0 by design — the
              -- unavailable sentinel is the signal); the floor must be exempted at every layer
              -- (fails.md:1547 vanish trap) or the sentinel would silently vanish at the DB read.
              -- feature 190: this stays the SOLE floor; the source/action filters below are NOT
              -- exempt for muted/unavailable rows (parity with the pre-190 client).
              AND (o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable')
              -- feature 190: source filter — an empty $7 array applies NO predicate (never = ANY of
              -- an empty array, which would return zero rows and empty the default view).
              AND (cardinality($7::text[]) = 0 OR ps.elem = ANY($7::text[]))
              -- feature 190: action filter on o.action (OpportunityActionTag), $8 = 0 → any action.
              AND ($8::int = 0 OR o.action = $8::int)
              AND COALESCE(a.action, 0) <> $4
              AND NOT (
                    COALESCE(a.action, 0) = $5
                    AND a.snooze_until IS NOT NULL
                    AND a.snooze_until > now()
              )
            -- feature 187/190: server-side symbol grouping — each symbol's rows stay contiguous,
            -- positioned by the group's best member. The ORDER BY is selected from the constant
            -- _SORT_ORDER_BY dict (feature 185 FR-5: opportunity_key ASC tiebreak in every branch).
            ORDER BY {order_by}
            """,
            user_id,
            min_conviction,
            w,
            _ACTION_DISMISS,
            _ACTION_SNOOZE,
            _PROVENANCE_STRUCTURAL_MARKERS,
            srcs,
            int(action_filter),
        )
        return [_to_dict(r) for r in rows]

    async def available_sources(self, user_id: str, *, include_expired: bool) -> list[str]:
        """feature 190 — the distinct derived primary sources in the user's disposition-filtered
        queue (DISMISS + active SNOOZE dropped, same as ``read``), scoped to the same freshness as
        the served page via ``include_expired``. Takes NO ``sources``/``action_filter``/
        ``min_conviction`` params — that absence makes the facet independent of the request filters
        (so a source the user selected can never disappear from the chip menu and strand the queue,
        @AC-12). ``CROSS JOIN LATERAL`` drops empty-source rows so they never become chips.
        """
        valid_clause = "" if include_expired else "AND o.valid_until > now()"
        rows = await self._db.fetch(
            f"""
            SELECT DISTINCT ps.elem AS source
            FROM analysis.opportunities o
            LEFT JOIN analysis.opportunity_actions a
              ON a.user_id = o.user_id AND a.opportunity_key = o.opportunity_key
            CROSS JOIN LATERAL (
              SELECT elem FROM jsonb_array_elements_text(o.provenance) WITH ORDINALITY t(elem, ord)
              WHERE elem <> ALL($2::text[]) ORDER BY ord LIMIT 1
            ) ps
            WHERE o.user_id = $1
              {valid_clause}
              AND COALESCE(a.action, 0) <> $3
              AND NOT (
                    COALESCE(a.action, 0) = $4
                    AND a.snooze_until IS NOT NULL
                    AND a.snooze_until > now()
              )
            """,
            user_id,
            _PROVENANCE_STRUCTURAL_MARKERS,
            _ACTION_DISMISS,
            _ACTION_SNOOZE,
        )
        return sorted(r["source"] for r in rows if r["source"])

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
