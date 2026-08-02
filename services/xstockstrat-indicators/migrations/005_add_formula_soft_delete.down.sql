DROP INDEX IF EXISTS indicators.idx_formulas_author_live;
ALTER TABLE indicators.formulas DROP COLUMN deleted_at;
