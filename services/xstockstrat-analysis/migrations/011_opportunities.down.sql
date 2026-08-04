-- Migration: 011_opportunities.down.sql
-- Service: xstockstrat-analysis
-- Reverses 011_opportunities.up.sql (feature 097).

DROP INDEX IF EXISTS analysis.idx_opportunities_user_valid;
DROP TABLE IF EXISTS analysis.opportunities;
