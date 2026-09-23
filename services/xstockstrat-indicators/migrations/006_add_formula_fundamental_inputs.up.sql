ALTER TABLE indicators.formulas
    ADD COLUMN fundamental_inputs JSONB NOT NULL DEFAULT '[]';
