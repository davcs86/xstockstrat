-- Reverse migration 009: drop the offline_position_baselines table (feature 163).

DROP INDEX IF EXISTS trading.idx_offline_position_baselines_account_asof;
DROP TABLE IF EXISTS trading.offline_position_baselines;
