"""Feature 177 FR-1 — per-(user, strategy, rule, symbol) readiness cache.

EvaluateReadiness serves a FAST path from this table when the definition fingerprint matches and
``valid_until`` has not elapsed, and re-evaluates (SLOW path) on any miss. Mirrors the
``OpportunitiesRepository`` JSONB/pool conventions; reuses the existing analysis pool (F-06).
"""

import json


def _to_dict(row) -> dict:
    d = dict(row)
    raw = d.get("readiness_json")
    if isinstance(raw, str):
        d["readiness_json"] = json.loads(raw) if raw else {}
    elif raw is None:
        d["readiness_json"] = {}
    return d


class ReadinessCacheRepository:
    def __init__(self, db_pool):
        self._db = db_pool

    async def read_many(
        self, user_id: str, strategy_id: str, rule: str, symbols: list[str]
    ) -> dict[str, dict]:
        """Return the cached rows for the (user, strategy, rule, symbol IN …) set by symbol."""
        if not symbols:
            return {}
        rows = await self._db.fetch(
            """
            SELECT symbol, def_fingerprint, bar_epoch, readiness_json, computed_at, valid_until
              FROM analysis.readiness_cache
             WHERE user_id = $1 AND strategy_id = $2 AND rule = $3 AND symbol = ANY($4)
            """,
            user_id,
            strategy_id,
            rule,
            list(symbols),
        )
        return {r["symbol"]: _to_dict(r) for r in rows}

    async def upsert_many(self, rows: list[dict]) -> None:
        """Literal upsert — every NOT NULL column supplied (an empty-bars symbol writes
        readiness_json = {} , never NULL). ON CONFLICT on the composite PK."""
        if not rows:
            return
        async with self._db.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO analysis.readiness_cache
                    (user_id, strategy_id, rule, symbol, def_fingerprint, bar_epoch,
                     readiness_json, computed_at, valid_until)
                VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
                ON CONFLICT (user_id, strategy_id, rule, symbol) DO UPDATE SET
                    def_fingerprint = EXCLUDED.def_fingerprint,
                    bar_epoch       = EXCLUDED.bar_epoch,
                    readiness_json  = EXCLUDED.readiness_json,
                    computed_at     = EXCLUDED.computed_at,
                    valid_until     = EXCLUDED.valid_until
                """,
                [
                    (
                        r["user_id"],
                        r["strategy_id"],
                        r["rule"],
                        r["symbol"],
                        r["def_fingerprint"],
                        r["bar_epoch"],
                        json.dumps(r.get("readiness_json", {})),
                        r["computed_at"],
                        r["valid_until"],
                    )
                    for r in rows
                ],
            )
