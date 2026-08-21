"""
OrderSnapshotsRepository — asyncpg persistence for analysis.order_snapshots (feature 042).

One row per captured order-lifecycle event; JSONB for the ohlcv bar, indicator map, and signal
list. Inserts are idempotent on (event_id, event_ts) so a ledger redelivery is a no-op. Accepts
either the pool or a live connection (so the consumer can insert inside its atomic txn).
"""

import json


class OrderSnapshotsRepository:
    def __init__(self, db):
        self._db = db

    async def insert(
        self,
        db,
        *,
        event_id: str,
        order_id: str,
        position_id: str,
        symbol: str,
        event_type: str,
        event_ts,
        strategy_id: str | None,
        side: str | None,
        quantity: float | None,
        price: float | None,
        ohlcv_bar: dict | None,
        indicators: dict | None,
        signals: list | None,
    ) -> None:
        await db.execute(
            """
            INSERT INTO analysis.order_snapshots
                (event_id, order_id, position_id, symbol, event_type, event_ts, strategy_id,
                 side, quantity, price, ohlcv_bar, indicators, signals)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
            ON CONFLICT (event_id, event_ts) DO NOTHING
            """,
            event_id,
            order_id,
            position_id,
            symbol,
            event_type,
            event_ts,
            strategy_id,
            side,
            quantity,
            price,
            json.dumps(ohlcv_bar) if ohlcv_bar is not None else None,
            json.dumps(indicators or {}),
            json.dumps(signals or []),
        )

    async def count_for_position(self, position_id: str) -> int:
        """Snapshot count for a position — the seal-time completeness diagnostic (v1)."""
        return await self._db.fetchval(
            "SELECT COUNT(*) FROM analysis.order_snapshots WHERE position_id=$1", position_id
        )

    async def list_for_position(self, position_id: str) -> list[dict]:
        """Entry/exit snapshots for a sealed position — the factor source for pattern samples."""
        rows = await self._db.fetch(
            "SELECT indicators, signals FROM analysis.order_snapshots "
            "WHERE position_id=$1 ORDER BY event_ts ASC",
            position_id,
        )
        return [dict(r) for r in rows]
