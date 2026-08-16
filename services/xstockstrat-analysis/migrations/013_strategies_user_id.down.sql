-- Reverse of 013: restore the single-column strategy_id primary key and drop user_id.
-- A strategy_id-only PK is only restorable if no two rows share a strategy_id — acceptable for a
-- rollback that undoes the same-deploy migration before cross-user duplicates can be created.

ALTER TABLE analysis.strategies DROP CONSTRAINT strategies_pkey;
ALTER TABLE analysis.strategies ADD PRIMARY KEY (strategy_id);
ALTER TABLE analysis.strategies DROP COLUMN IF EXISTS user_id;
