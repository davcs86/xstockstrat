"""
StrategyScoresRepository — asyncpg-backed persistence for analysis.strategy_scores_v2.

Mirrors the DB-query style of app/repositories/strategies.py (fetchrow / fetch,
``json.dumps(...)::jsonb`` binding). One latest score per owned strategy: writes are an upsert
on the ``(user_id, strategy_id)`` primary key (feature 224 — two users may each own the same
strategy_id). The DB is a durability backup for the servicer's in-memory score dict; reads
happen at boot (hydrate).
"""

import json


def _to_dict(row) -> dict | None:
    """Convert an asyncpg Record to a plain dict, decoding the JSONB component_scores."""
    if row is None:
        return None
    d = dict(row)
    raw = d.get("component_scores")
    if isinstance(raw, str):
        d["component_scores"] = json.loads(raw) if raw else {}
    elif raw is None:
        d["component_scores"] = {}
    return d


class StrategyScoresRepository:
    """Upsert/read persistence for the ``analysis.strategy_scores_v2`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def upsert(
        self,
        user_id: str,
        strategy_id: str,
        overall_score: float,
        rating: str,
        component_scores: dict,
        n_symbols: int = 0,
        total_trading_days: int = 0,
        provisional: bool = False,
    ) -> dict:
        row = await self._db.fetchrow(
            """
            INSERT INTO analysis.strategy_scores_v2
                (user_id, strategy_id, overall_score, rating, component_scores,
                 n_symbols, total_trading_days, provisional)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
            ON CONFLICT (user_id, strategy_id) DO UPDATE SET
                overall_score      = EXCLUDED.overall_score,
                rating             = EXCLUDED.rating,
                component_scores   = EXCLUDED.component_scores,
                n_symbols          = EXCLUDED.n_symbols,
                total_trading_days = EXCLUDED.total_trading_days,
                provisional        = EXCLUDED.provisional,
                updated_at         = NOW()
            RETURNING *
            """,
            user_id,
            strategy_id,
            overall_score,
            rating,
            json.dumps(dict(component_scores) if component_scores else {}),
            n_symbols,
            total_trading_days,
            provisional,
        )
        return _to_dict(row)

    async def delete(self, user_id: str, strategy_id: str) -> None:
        """Remove a strategy's materialized score (feature 065 — clear a stale grade).

        Used when a recompute finds zero eligible evidence (e.g. after a definition change),
        so a broad old grade never lingers past the change that invalidated its evidence base.
        """
        await self._db.execute(
            "DELETE FROM analysis.strategy_scores_v2 WHERE user_id = $1 AND strategy_id = $2",
            user_id,
            strategy_id,
        )

    async def get_by_id(self, user_id: str, strategy_id: str) -> dict | None:
        row = await self._db.fetchrow(
            "SELECT * FROM analysis.strategy_scores_v2 WHERE user_id = $1 AND strategy_id = $2",
            user_id,
            strategy_id,
        )
        return _to_dict(row)

    async def list(self) -> list[dict]:
        rows = await self._db.fetch("SELECT * FROM analysis.strategy_scores_v2")
        return [_to_dict(r) for r in rows]

    async def list_unscored_pairs(self, limit: int) -> "list[tuple[str, str]]":
        """Owner pairs of strategy_ids held by more than one owner that have no v2 score yet.

        Migration 026 seeds v2 only for unambiguous ids; these pairs are recomputed from their own
        evidence at boot. Only pairs with owner evidence cells are returned, so a pair that can
        never score does not hold a slot of the per-pass ``limit`` forever.
        """
        rows = await self._db.fetch(
            """
            SELECT s.user_id, s.strategy_id
            FROM analysis.strategies s
            WHERE s.strategy_id IN (
                    SELECT strategy_id FROM analysis.strategies
                    GROUP BY strategy_id HAVING count(*) > 1
                  )
              AND NOT EXISTS (
                    SELECT 1 FROM analysis.strategy_scores_v2 v
                    WHERE v.user_id = s.user_id AND v.strategy_id = s.strategy_id
                  )
              AND EXISTS (
                    SELECT 1 FROM analysis.backtest_run_symbols b
                    WHERE b.user_id = s.user_id AND b.strategy_id = s.strategy_id
                  )
            ORDER BY s.strategy_id, s.user_id
            LIMIT $1
            """,
            limit,
        )
        return [(r["user_id"], r["strategy_id"]) for r in rows]
