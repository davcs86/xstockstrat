-- Reverse of 014: restore the (strategy_id, symbol) primary key and drop user_id.

ALTER TABLE analysis.strategy_cooldowns DROP CONSTRAINT strategy_cooldowns_pkey;
ALTER TABLE analysis.strategy_cooldowns ADD PRIMARY KEY (strategy_id, symbol);
ALTER TABLE analysis.strategy_cooldowns DROP COLUMN IF EXISTS user_id;
