-- Feature 133: add user_id to analysis.backtest_runs for attribution. Plain column add — the PK is
-- backtest_id (not strategy_id), so no PK change. Left NULLABLE on purpose: a historical run whose
-- strategy_id no longer resolves (or an inline/legacy-SMA run that never had a registered strategy)
-- legitimately has no owner, and this append-only history table is not an ownership boundary
-- (retroactive reattribution is out of scope per the product spec).

ALTER TABLE analysis.backtest_runs ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE analysis.backtest_runs r
   SET user_id = s.user_id
  FROM analysis.strategies s
 WHERE r.strategy_id = s.strategy_id AND r.user_id IS NULL;
