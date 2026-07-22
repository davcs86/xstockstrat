"""
BacktestDetailsRepository — asyncpg-backed persistence for analysis.backtest_details.

One row per OK ``RunBacktest`` (migration ``008_backtest_details``): the fully-assembled
``analysis.v1.BacktestResult`` serialized to its proto wire bytes ("store what you serve",
ledger insights 2026-07-21) — no SQL ever inspects the payload; ``GetBacktest`` returns it
verbatim. The FK to ``analysis.backtest_runs`` means a detail row can only exist for a
listed summary row (C-10(b) existence parity). ``completed_at`` is stamped explicitly from
``result.completed_at`` so eviction order and ``ListBacktests`` order agree.

Retention is count-based per strategy: ``insert`` evicts everything beyond the newest
``retention`` rows in a second statement. The two statements are intentionally
non-transactional (design.md accepted open risk): a crash between them leaves at most one
extra row until the next insert evicts it.
"""


class BacktestDetailsRepository:
    """Insert/read persistence for the ``analysis.backtest_details`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def insert(
        self,
        *,
        backtest_id: str,
        strategy_id: str,
        completed_at,
        result_pb: bytes,
        retention: int,
    ) -> None:
        """Insert one detail row, then evict beyond the newest ``retention`` per strategy."""
        await self._db.execute(
            """
            INSERT INTO analysis.backtest_details
                (backtest_id, strategy_id, completed_at, result_pb)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (backtest_id) DO NOTHING
            """,
            backtest_id,
            strategy_id,
            completed_at,
            result_pb,
        )
        await self._db.execute(
            """
            DELETE FROM analysis.backtest_details
            WHERE strategy_id = $1
              AND backtest_id NOT IN (
                SELECT backtest_id FROM analysis.backtest_details
                WHERE strategy_id = $1
                ORDER BY completed_at DESC
                LIMIT $2
              )
            """,
            strategy_id,
            retention,
        )

    async def get(self, backtest_id: str) -> bytes | None:
        """Return the persisted wire bytes for a run, or ``None`` when no detail exists."""
        row = await self._db.fetchrow(
            "SELECT result_pb FROM analysis.backtest_details WHERE backtest_id = $1",
            backtest_id,
        )
        return row["result_pb"] if row is not None else None
