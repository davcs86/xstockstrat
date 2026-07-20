"""
StrategyScoresRepository — asyncpg-backed persistence for analysis.strategy_scores.

Mirrors the DB-query style of app/repositories/strategies.py (fetchrow / fetch,
``json.dumps(...)::jsonb`` binding). One latest score per strategy: writes are an upsert
on the ``strategy_id`` primary key (feature 064 — persist-strategy-scores). The DB is a
durability backup for the servicer's in-memory score dict; reads happen at boot (hydrate).
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
    """Upsert/read persistence for the ``analysis.strategy_scores`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def upsert(
        self,
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
            INSERT INTO analysis.strategy_scores
                (strategy_id, overall_score, rating, component_scores,
                 n_symbols, total_trading_days, provisional)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
            ON CONFLICT (strategy_id) DO UPDATE SET
                overall_score      = EXCLUDED.overall_score,
                rating             = EXCLUDED.rating,
                component_scores   = EXCLUDED.component_scores,
                n_symbols          = EXCLUDED.n_symbols,
                total_trading_days = EXCLUDED.total_trading_days,
                provisional        = EXCLUDED.provisional,
                updated_at         = NOW()
            RETURNING *
            """,
            strategy_id,
            overall_score,
            rating,
            json.dumps(dict(component_scores) if component_scores else {}),
            n_symbols,
            total_trading_days,
            provisional,
        )
        return _to_dict(row)

    async def delete(self, strategy_id: str) -> None:
        """Remove a strategy's materialized score (feature 065 — clear a stale grade).

        Used when a recompute finds zero eligible evidence (e.g. after a definition change),
        so a broad old grade never lingers past the change that invalidated its evidence base.
        """
        await self._db.execute(
            "DELETE FROM analysis.strategy_scores WHERE strategy_id = $1",
            strategy_id,
        )

    async def get_by_id(self, strategy_id: str) -> dict | None:
        row = await self._db.fetchrow(
            "SELECT * FROM analysis.strategy_scores WHERE strategy_id = $1",
            strategy_id,
        )
        return _to_dict(row)

    async def list(self) -> list[dict]:
        rows = await self._db.fetch("SELECT * FROM analysis.strategy_scores")
        return [_to_dict(r) for r in rows]
