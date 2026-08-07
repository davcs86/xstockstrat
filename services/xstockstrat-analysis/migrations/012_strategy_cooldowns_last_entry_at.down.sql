-- Reverse in the opposite order the up.sql applied them. Restoring NOT NULL on last_exit_at
-- assumes no row exists with a NULL value at rollback time (true if this migration is rolled
-- back before any entry-first row was ever written — the expected rollback window).
ALTER TABLE analysis.strategy_cooldowns ALTER COLUMN last_exit_at SET NOT NULL;
ALTER TABLE analysis.strategy_cooldowns DROP COLUMN IF EXISTS last_entry_at;
