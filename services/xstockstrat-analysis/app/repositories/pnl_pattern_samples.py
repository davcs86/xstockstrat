"""
PnLPatternSamplesRepository — asyncpg persistence + query for analysis.pnl_pattern_samples (042).

Raw attribution store: one row per (sealed position × factor). No factor UNIQUE (buckets
computed
at query time). `insert_many` writes a sealed position's factors; `query` powers QueryPnLPatterns.
"""


class PnLPatternSamplesRepository:
    def __init__(self, db):
        self._db = db

    async def insert_many(self, db, rows: list[dict]) -> None:
        for r in rows:
            await db.execute(
                """
                INSERT INTO analysis.pnl_pattern_samples
                    (symbol, strategy_id, factor_name, factor_type, indicator_value,
                     signal_present, realized_pnl, closed_at, close_event_id, position_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                """,
                r["symbol"],
                r.get("strategy_id"),
                r["factor_name"],
                r["factor_type"],
                r.get("indicator_value"),
                r.get("signal_present"),
                r["realized_pnl"],
                r["closed_at"],
                r["close_event_id"],
                r["position_id"],
            )

    async def query(
        self, *, symbol: str, strategy_id: str = "", from_ts=None, to_ts=None
    ) -> list[dict]:
        """All samples for a symbol (optionally narrowed by strategy/time)."""
        conds = ["symbol=$1"]
        args = [symbol]
        if strategy_id:
            args.append(strategy_id)
            conds.append(f"strategy_id=${len(args)}")
        if from_ts is not None:
            args.append(from_ts)
            conds.append(f"closed_at >= ${len(args)}")
        if to_ts is not None:
            args.append(to_ts)
            conds.append(f"closed_at <= ${len(args)}")
        rows = await self._db.fetch(
            "SELECT factor_name, factor_type, indicator_value, signal_present, realized_pnl "
            "FROM analysis.pnl_pattern_samples WHERE " + " AND ".join(conds),
            *args,
        )
        return [dict(r) for r in rows]
