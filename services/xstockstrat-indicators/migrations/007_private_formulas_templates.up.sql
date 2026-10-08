-- Migration: 007_private_formulas_templates.up.sql
-- Service: xstockstrat-indicators
-- feature 224 (release N, expand-only). Must stay idempotent on the expanded AND the contracted schema:
-- db-migrate.sh dirty recovery replays from 001. No formula row is deleted (AC-22).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'indicators' AND table_name = 'formulas' AND column_name = 'is_public'
  ) THEN
    UPDATE indicators.formulas SET is_public = FALSE WHERE is_public;
  END IF;
END $$;

-- 001 created this partial index unnamed, so it is located by definition, not by name.
DO $$
DECLARE
  idx RECORD;
BEGIN
  FOR idx IN
    SELECT indexname FROM pg_indexes
     WHERE schemaname = 'indicators' AND tablename = 'formulas' AND indexdef LIKE '%(is_public)%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS indicators.%I', idx.indexname);
  END LOOP;
END $$;

ALTER TABLE indicators.formulas
    ADD COLUMN IF NOT EXISTS origin_template_id      TEXT,
    ADD COLUMN IF NOT EXISTS origin_template_version INTEGER,
    ADD COLUMN IF NOT EXISTS pending_intent_id       UUID;

CREATE INDEX IF NOT EXISTS idx_formulas_pending_intent
    ON indicators.formulas (pending_intent_id)
    WHERE pending_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS indicators.formula_templates (
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

-- No seed rows (AC-15): templates are authored by admins at runtime.
