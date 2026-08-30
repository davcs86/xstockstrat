-- Reverse migration 013: drop provenance columns from portfolio.positions (feature 163).

ALTER TABLE portfolio.positions DROP COLUMN IF EXISTS as_of;
ALTER TABLE portfolio.positions DROP COLUMN IF EXISTS source;
