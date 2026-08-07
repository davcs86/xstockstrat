-- Live-loop exit-cooldown state (feature 116). Extends the table feature 069 created — the
-- same (strategy_id, symbol) key now carries both the re-entry gate's last-exit anchor and
-- the exit-cooldown gate's last-entry anchor. NULL for a pair with no known entry time yet
-- (see app/engine/entry_backfill.py). Migration 009 itself is NOT edited (F-01).
ALTER TABLE analysis.strategy_cooldowns ADD COLUMN IF NOT EXISTS last_entry_at TIMESTAMPTZ NULL;
