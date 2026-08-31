"""
PnLPositionsRepository — asyncpg persistence for analysis.pnl_positions (feature 042).

The synthesized open→close window a position lives through. `open` is a no-op if an open row for
the identity key already exists (partial unique index). `seal` stamps closed_at/realized_pnl and is
deduped on close_event_id so a redelivered close event seals at most once.
"""


class PnLPositionsRepository:
    def __init__(self, db):
        self._db = db

    async def open(
        self,
        db,
        *,
        position_id: str,
        user_id: str,
        account_id: str,
        symbol: str,
        trading_mode: str,
        strategy_id: str | None,
        opened_at,
        open_event_id: str,
    ) -> None:
        await db.execute(
            """
            INSERT INTO analysis.pnl_positions
                (position_id, user_id, account_id, symbol, trading_mode, strategy_id,
                 opened_at, open_event_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (user_id, account_id, symbol, trading_mode)
                WHERE closed_at IS NULL DO NOTHING
            """,
            position_id,
            user_id,
            account_id,
            symbol,
            trading_mode,
            strategy_id,
            opened_at,
            open_event_id,
        )

    async def seal(
        self,
        db,
        *,
        user_id: str,
        account_id: str,
        symbol: str,
        trading_mode: str,
        closed_at,
        realized_pnl: float,
        close_event_id: str,
        fees_total: float = 0.0,
    ) -> dict | None:
        """Seal the matching open row. Returns the sealed row (position_id/strategy_id/symbol) or
        None when there is no open row (an empty-window close no-ops). Dedup on close_event_id.
        realized_pnl stays gross/unchanged; fees_total (feature 029) is stored alongside so
        GetAttribution computes net = realized_pnl - fees_total (0 default ⇒ net == gross)."""
        row = await db.fetchrow(
            """
            UPDATE analysis.pnl_positions
               SET closed_at=$5, realized_pnl=$6, close_event_id=$7, fees_total=$8
             WHERE user_id=$1 AND account_id=$2 AND symbol=$3 AND trading_mode=$4
               AND closed_at IS NULL
            RETURNING position_id, strategy_id, symbol
            """,
            user_id,
            account_id,
            symbol,
            trading_mode,
            closed_at,
            realized_pnl,
            close_event_id,
            fees_total,
        )
        return dict(row) if row is not None else None
