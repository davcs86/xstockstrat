"""StrategyCooldownsRepository — asyncpg-backed persistence for analysis.strategy_cooldowns.

Durable per-(strategy_id, symbol) cooldown-gate state for the live evaluation loop. The table
now serves TWO gates sharing the same PK: the re-entry gate's last-exit anchor (feature 069,
migration 009) and the exit-cooldown gate's last-entry anchor (feature 116, migration 012).
Mirrors StrategyScoresRepository's upsert-on-PK shape: the live loop upserts on every transition
and hydrates the whole table into memory at boot, so both cooldowns survive a service restart
(FR-8). Backtests NEVER touch this table (FR-7 — backtest cooldown state is ephemeral, per-
RunBacktest, in-memory only). Reuses the existing asyncpg pool (no new pool — budget stays 2).

Both `last_exit_at` and `last_entry_at` are nullable as of migration 012: `upsert_entry` can
INSERT a brand-new row for a pair that has never exited (e.g. the boot-time entry backfill),
so `last_exit_at` can no longer be guaranteed present at insert time. A NULL anchor already
means "never gated" to `app.services.cooldown.is_cooldown_active` — no special-casing needed by
callers of `list_all()`.
"""

from datetime import datetime


class StrategyCooldownsRepository:
    """Upsert/read persistence for the ``analysis.strategy_cooldowns`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def upsert_exit(
        self, user_id: str, strategy_id: str, symbol: str, last_exit_at: datetime
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO analysis.strategy_cooldowns (user_id, strategy_id, symbol, last_exit_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, strategy_id, symbol) DO UPDATE SET
                last_exit_at = EXCLUDED.last_exit_at
            """,
            user_id,
            strategy_id,
            symbol,
            last_exit_at,
        )

    async def upsert_entry(
        self, user_id: str, strategy_id: str, symbol: str, last_entry_at: datetime
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO analysis.strategy_cooldowns (user_id, strategy_id, symbol, last_entry_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, strategy_id, symbol) DO UPDATE SET
                last_entry_at = EXCLUDED.last_entry_at
            """,
            user_id,
            strategy_id,
            symbol,
            last_entry_at,
        )

    async def list_all(self) -> list[dict]:
        rows = await self._db.fetch(
            "SELECT user_id, strategy_id, symbol, last_exit_at, last_entry_at "
            "FROM analysis.strategy_cooldowns"
        )
        return [dict(r) for r in rows]
