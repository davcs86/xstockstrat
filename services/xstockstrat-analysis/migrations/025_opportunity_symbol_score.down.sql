-- Migration: 025_opportunity_symbol_score.down.sql
ALTER TABLE analysis.opportunities DROP COLUMN IF EXISTS symbol_score;
