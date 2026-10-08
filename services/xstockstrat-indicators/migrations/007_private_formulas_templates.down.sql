-- Migration: 007_private_formulas_templates.down.sql
-- is_public values are not restored: lossy by design, private is the safe direction.
DROP TABLE IF EXISTS indicators.formula_templates;

DROP INDEX IF EXISTS indicators.idx_formulas_pending_intent;

ALTER TABLE indicators.formulas
    DROP COLUMN IF EXISTS pending_intent_id,
    DROP COLUMN IF EXISTS origin_template_version,
    DROP COLUMN IF EXISTS origin_template_id;

CREATE INDEX IF NOT EXISTS formulas_is_public_idx
    ON indicators.formulas (is_public)
    WHERE is_public = TRUE;
