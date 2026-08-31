-- Migration: 003_events_user_id.up.sql
-- Service: xstockstrat-ledger
-- Feature 021 (ledger-event-export): add a nullable owning-user column + a per-user,
-- global-sequence-ordered index backing the ExportEvents window scan (FR-10 / AC-1 / AC-11).
--
-- Additive DDL only (ADD COLUMN / CREATE INDEX) — never an UPDATE of existing rows, so the
-- append-only immutability guard (deny_mutation triggers, 001_ledger_events_hypertable.up.sql)
-- is untouched and historical rows keep user_id = NULL. Backfill is impossible by construction
-- (UPDATE is denied) and unnecessary: the export's `WHERE user_id = $caller` predicate excludes
-- NULL rows automatically.

ALTER TABLE ledger.events ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_events_user_sequence
    ON ledger.events (user_id, sequence);
