ALTER TABLE indicators.formulas
    ADD COLUMN outputs JSONB NOT NULL DEFAULT '[]';
