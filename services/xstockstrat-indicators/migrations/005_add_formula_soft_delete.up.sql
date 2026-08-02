-- Feature 086: soft-delete for formulas. DeleteFormula stamps deleted_at instead of a hard
-- DELETE, so strategies that already reference the formula keep evaluating (GetFormula /
-- ExecuteFormula stay deleted-agnostic) while ListFormulas hides it. NULL = live.
ALTER TABLE indicators.formulas
    ADD COLUMN deleted_at TIMESTAMPTZ NULL;

-- ListFormulas filters on deleted_at IS NULL, scanning by author; a partial index keeps that
-- path efficient without weighing on the hot get_by_id (PK) lookup.
CREATE INDEX idx_formulas_author_live
    ON indicators.formulas (author)
    WHERE deleted_at IS NULL;
