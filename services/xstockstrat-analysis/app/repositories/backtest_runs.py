"""
BacktestRunsRepository — asyncpg-backed persistence for analysis.backtest_runs.

Mirrors the DB-query style of app/repositories/strategy_scores.py (fetchrow / fetch).
One row per completed ``RunBacktest`` (migration ``006_backtest_runs``): summary metrics
plus the score the run earned. This is the durable backtest **history** that makes past
run results visible after a restart — the servicer's in-memory ``_backtests`` dict only
holds the single latest result per strategy.
"""


def _to_dict(row) -> dict | None:
    """Convert an asyncpg Record to a plain dict (symbols already decode to a list)."""
    if row is None:
        return None
    return dict(row)


class BacktestRunsRepository:
    """Insert/read persistence for the ``analysis.backtest_runs`` table."""

    def __init__(self, db_pool):
        self._db = db_pool

    async def insert(
        self,
        *,
        backtest_id: str,
        strategy_id: str,
        status: str,
        metrics: dict,
        symbols: list[str],
        overall_score: float | None,
        rating: str | None,
        range_start=None,
        range_end=None,
    ) -> dict:
        row = await self._db.fetchrow(
            """
            INSERT INTO analysis.backtest_runs
                (backtest_id, strategy_id, status, total_return, annualized_return,
                 sharpe_ratio, max_drawdown, win_rate, total_trades, profit_factor,
                 symbols, overall_score, rating, range_start, range_end)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (backtest_id) DO NOTHING
            RETURNING *
            """,
            backtest_id,
            strategy_id,
            status,
            float(metrics.get("total_return", 0.0)),
            float(metrics.get("annualized_return", 0.0)),
            float(metrics.get("sharpe_ratio", 0.0)),
            float(metrics.get("max_drawdown", 0.0)),
            float(metrics.get("win_rate", 0.0)),
            int(metrics.get("total_trades", 0)),
            float(metrics.get("profit_factor", 0.0)),
            list(symbols),
            overall_score,
            rating,
            range_start,
            range_end,
        )
        return _to_dict(row)

    async def list_by_strategy(self, strategy_id: str, limit: int = 20) -> list[dict]:
        rows = await self._db.fetch(
            """
            SELECT * FROM analysis.backtest_runs
            WHERE strategy_id = $1
            ORDER BY completed_at DESC
            LIMIT $2
            """,
            strategy_id,
            limit,
        )
        return [_to_dict(r) for r in rows]
