-- Live-loop exit-cooldown state (feature 116). Extends the table feature 069 created — the
-- same (strategy_id, symbol) key now carries both the re-entry gate's last-exit anchor and
-- the exit-cooldown gate's last-entry anchor. NULL for a pair with no known entry time yet
-- (see app/engine/entry_backfill.py). Migration 009 itself is NOT edited (F-01).
ALTER TABLE analysis.strategy_cooldowns ADD COLUMN IF NOT EXISTS last_entry_at TIMESTAMPTZ NULL;

-- Deviation (caught mid-Step-4, not by the design debate): 009's last_exit_at is NOT NULL,
-- which was a safe invariant when the only writer (upsert_exit) always supplied a real
-- timestamp. upsert_entry (this feature) can now INSERT a brand-new row for a pair that has
-- never exited — an entry-first upsert (boot backfill, or a live entry on a pair with no prior
-- exit history) — and PostgreSQL rejects an INSERT that omits a NOT NULL column with no
-- DEFAULT. Relax it here rather than fabricate a sentinel last_exit_at value (a fake timestamp
-- would be silently misread as a real anchor by is_cooldown_active — worse than a schema
-- change). Application code must treat NULL last_exit_at as "never exited" (already
-- is_cooldown_active's existing None-anchor semantics — no behavior change there).
ALTER TABLE analysis.strategy_cooldowns ALTER COLUMN last_exit_at DROP NOT NULL;
