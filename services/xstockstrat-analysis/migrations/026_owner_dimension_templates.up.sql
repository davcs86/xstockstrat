-- requires-env: SEED_USER_ID
-- Migration: 026_owner_dimension_templates.up.sql
-- Service: xstockstrat-analysis
-- feature 224 (release N, expand-only). Must stay idempotent on the expanded AND the contracted schema:
-- db-migrate.sh dirty recovery replays from 001. No triggers here; NOT NULL is deferred to the contract.

DO $$
DECLARE
  seed TEXT := '${SEED_USER_ID}';
BEGIN
  IF seed IS NULL OR seed = '' OR seed LIKE '%$' || '{%' THEN
    RAISE EXCEPTION 'migration 026: SEED_USER_ID is unset/unrendered (got "%")', seed;
  END IF;
END $$;

-- D-1: a legacy run takes its strategy's owner only when exactly one owner holds that strategy_id.
UPDATE analysis.backtest_runs r
   SET user_id = (
         SELECT min(s.user_id)
           FROM analysis.strategies s
          WHERE s.strategy_id = r.strategy_id
         HAVING count(DISTINCT s.user_id) = 1
       )
 WHERE r.user_id IS NULL;

UPDATE analysis.backtest_runs
   SET user_id = '${SEED_USER_ID}'
 WHERE user_id IS NULL;

ALTER TABLE analysis.backtest_run_symbols ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE analysis.backtest_run_symbols b
   SET user_id = r.user_id
  FROM analysis.backtest_runs r
 WHERE b.backtest_id = r.backtest_id AND b.user_id IS NULL;

ALTER TABLE analysis.backtest_details ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE analysis.backtest_details d
   SET user_id = r.user_id
  FROM analysis.backtest_runs r
 WHERE d.backtest_id = r.backtest_id AND d.user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_brs_owner_eligibility
    ON analysis.backtest_run_symbols
    (user_id, strategy_id, definition_fingerprint, symbol, (total_trades > 0) DESC, trading_days DESC, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_backtest_details_owner_strategy_completed
    ON analysis.backtest_details (user_id, strategy_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS analysis.strategy_scores_v2 (
    user_id            TEXT NOT NULL,
    strategy_id        TEXT NOT NULL,
    overall_score      DOUBLE PRECISION NOT NULL,
    rating             TEXT NOT NULL,
    component_scores   JSONB NOT NULL DEFAULT '{}'::jsonb,
    n_symbols          INTEGER NOT NULL DEFAULT 0,
    total_trading_days INTEGER NOT NULL DEFAULT 0,
    provisional        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, strategy_id)
);

-- Only unambiguous strategy_ids are seeded; ambiguous ones are recomputed at boot. The contract drops
-- strategy_scores, so the read is to_regclass-guarded.
DO $$
BEGIN
  IF to_regclass('analysis.strategy_scores') IS NOT NULL THEN
    INSERT INTO analysis.strategy_scores_v2
        (user_id, strategy_id, overall_score, rating, component_scores, n_symbols,
         total_trading_days, provisional, created_at, updated_at)
    SELECT s.user_id, sc.strategy_id, sc.overall_score, sc.rating, sc.component_scores, sc.n_symbols,
           sc.total_trading_days, sc.provisional, sc.created_at, sc.updated_at
      FROM analysis.strategy_scores sc
      JOIN analysis.strategies s USING (strategy_id)
     WHERE sc.strategy_id IN (
             SELECT strategy_id FROM analysis.strategies GROUP BY strategy_id HAVING count(*) = 1
           )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

ALTER TABLE analysis.strategies
    ADD COLUMN IF NOT EXISTS origin_template_id      TEXT,
    ADD COLUMN IF NOT EXISTS origin_template_version INTEGER;

-- No seed rows (AC-15): templates are authored by admins at runtime.
CREATE TABLE IF NOT EXISTS analysis.strategy_templates (
    template_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    payload     JSONB NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    retired_at  TIMESTAMP WITH TIME ZONE,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis.template_intents (
    intent_id        UUID PRIMARY KEY,
    user_id          TEXT NOT NULL,
    template_id      TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    strategy_id      TEXT NOT NULL,
    state            TEXT NOT NULL
        CHECK (state IN ('PENDING', 'COMMITTED', 'FINALIZED', 'ABORTING', 'ABORTED')),
    formula_ids      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_intents_state_updated
    ON analysis.template_intents (state, updated_at);
