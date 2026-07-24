"""StrategyCooldownsRepository — asyncpg-backed persistence for analysis.strategy_cooldowns.

Durable per-(strategy_id, symbol) last-exit timestamp for the live evaluation loop's re-entry
cooldown (feature 069, migration 009). Mirrors StrategyScoresRepository's upsert-on-PK shape:
the live loop upserts on every exit and hydrates the whole table into memory at boot, so the
cooldown survives a service restart (FR-8). Backtests NEVER touch this table (FR-7 — backtest
cooldown state is ephemeral, per-RunBacktest, in-memory only). Reuses the existing asyncpg pool
(no new pool — budget stays 2).
"""

from datetime import datetime


class StrategyCooldownsRepository:
    """Upsert/read persistence for the ``analysis.strategy_cooldowns`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def upsert(self, strategy_id: str, symbol: str, last_exit_at: datetime) -> None:
        await self._db.execute(
            """
            INSERT INTO analysis.strategy_cooldowns (strategy_id, symbol, last_exit_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (strategy_id, symbol) DO UPDATE SET
                last_exit_at = EXCLUDED.last_exit_at
            """,
            strategy_id,
            symbol,
            last_exit_at,
        )

    async def list_all(self) -> list[dict]:
        rows = await self._db.fetch(
            "SELECT strategy_id, symbol, last_exit_at FROM analysis.strategy_cooldowns"
        )
        return [dict(r) for r in rows]
