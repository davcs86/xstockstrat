ALTER TABLE indicators.formulas
    ADD COLUMN parameters JSONB NOT NULL DEFAULT '[]';
