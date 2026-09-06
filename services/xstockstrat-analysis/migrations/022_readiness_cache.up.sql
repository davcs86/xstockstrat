-- Migration: 022_readiness_cache.up.sql
-- Service: xstockstrat-analysis
-- Per-(user,strategy,rule,symbol) readiness cache (feature 177, FR-1): EvaluateReadiness serves a
-- FAST path from this table when the definition fingerprint matches and valid_until has not elapsed,
-- and re-evaluates (SLOW path) on any miss / fingerprint change / expiry. A keyed cache, not a time
-- series (no hypertable). Reuses the existing analysis asyncpg pool (budget 2).

CREATE TABLE IF NOT EXISTS analysis.readiness_cache (
    user_id         TEXT        NOT NULL,
    strategy_id     TEXT        NOT NULL,
    rule            TEXT        NOT NULL,   -- 'entry' | 'exit'
    symbol          TEXT        NOT NULL,
    def_fingerprint TEXT        NOT NULL,
    bar_epoch       BIGINT      NOT NULL,
    readiness_json  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, strategy_id, rule, symbol)
);
