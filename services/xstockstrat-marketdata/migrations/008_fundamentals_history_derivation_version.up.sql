-- feature 223: stamp each fundamentals_history row with the EDGAR period-builder derivation version
-- that produced its statement-derived columns (roe, debt_to_equity, eps, extra_metrics). Existing
-- rows are 0 ("pre-versioning") so a re-backfill re-derives them; the filed_date pin is untouched.
ALTER TABLE marketdata.fundamentals_history
    ADD COLUMN IF NOT EXISTS derivation_version SMALLINT NOT NULL DEFAULT 0;
