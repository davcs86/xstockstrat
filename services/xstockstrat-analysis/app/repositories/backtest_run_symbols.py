"""
BacktestRunSymbolsRepository — asyncpg-backed persistence for analysis.backtest_run_symbols.

Feature 065 (cross-stock score derivation). Persists one (symbol × window) **evidence cell**
per symbol per completed OK ``RunBacktest`` (migration ``007_backtest_run_symbols``). The
headline strategy grade is derived from the breadth + duration of these cells rather than
overwritten last-run-wins, so a throwaway single-symbol run can never displace a well-evidenced
grade. Mirrors the DB-query style of app/repositories/backtest_runs.py.
"""


def _to_dict(row) -> dict | None:
    """Convert an asyncpg Record to a plain dict."""
    if row is None:
        return None
    return dict(row)


class BacktestRunSymbolsRepository:
    """Insert/read persistence for the ``analysis.backtest_run_symbols`` table."""

    # Positional order for the executemany bind tuples — matches the INSERT column list.
    # ``completed_at`` is intentionally omitted so the DB default (NOW()) stamps every cell
    # from one run identically.
    _COLUMNS = (
        "backtest_id",
        "strategy_id",
        "symbol",
        "sharpe_ratio",
        "max_drawdown",
        "win_rate",
        "total_return",
        "total_trades",
        "trading_days",
        "definition_fingerprint",
        "range_start",
        "range_end",
    )

    def __init__(self, db_pool):
        self._db = db_pool

    async def insert_many(self, cells: list[dict]) -> None:
        """Bulk-insert evidence cells in one ``executemany`` (ON CONFLICT DO NOTHING).

        Replays of the same backtest add no weight — the (backtest_id, symbol) primary key
        makes re-inserts idempotent.
        """
        if not cells:
            return
        await self._db.executemany(
            """
            INSERT INTO analysis.backtest_run_symbols
                (backtest_id, strategy_id, symbol, sharpe_ratio, max_drawdown, win_rate,
                 total_return, total_trades, trading_days, definition_fingerprint,
                 range_start, range_end)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (backtest_id, symbol) DO NOTHING
            """,
            [tuple(c.get(col) for col in self._COLUMNS) for c in cells],
        )

    async def fetch_eligible(self, strategy_id: str, fingerprint: str) -> list[dict]:
        """One eligible cell per symbol for a (strategy, fingerprint) pair.

        Traded-first dedup (user decision): a traded cell always wins over a zero-trade cell on
        the same symbol, then most trading days, then newest — so non-participation can never
        shadow real traded evidence, but a symbol with only zero-trade cells still contributes
        one cell (zero-trade cells count as evidence).
        """
        rows = await self._db.fetch(
            """
            SELECT DISTINCT ON (symbol) *
            FROM analysis.backtest_run_symbols
            WHERE strategy_id = $1 AND definition_fingerprint = $2
            ORDER BY symbol, (total_trades > 0) DESC, trading_days DESC, completed_at DESC
            """,
            strategy_id,
            fingerprint,
        )
        return [_to_dict(r) for r in rows]
