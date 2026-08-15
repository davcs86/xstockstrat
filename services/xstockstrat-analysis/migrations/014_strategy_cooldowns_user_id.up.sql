-- Feature 133: owner-key analysis.strategy_cooldowns to match the composite strategy identity.
-- Backfill is purely mechanical: by the time this runs, 013 has guaranteed every analysis.strategies
-- row has a non-null user_id, so the JOIN resolves every live cooldown row's owner.

ALTER TABLE analysis.strategy_cooldowns ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE analysis.strategy_cooldowns c
   SET user_id = s.user_id
  FROM analysis.strategies s
 WHERE c.strategy_id = s.strategy_id AND c.user_id IS NULL;

-- Any cooldown row whose strategy_id no longer resolves is orphaned pre-feature state; delete it
-- rather than leave a NOT NULL violation (these are live-loop cache rows, safe to drop).
DELETE FROM analysis.strategy_cooldowns WHERE user_id IS NULL;

ALTER TABLE analysis.strategy_cooldowns ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE analysis.strategy_cooldowns DROP CONSTRAINT strategy_cooldowns_pkey;
ALTER TABLE analysis.strategy_cooldowns ADD PRIMARY KEY (user_id, strategy_id, symbol);
