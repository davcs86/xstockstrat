-- Migration: 024_opportunity_composite_score.down.sql
ALTER TABLE analysis.opportunities DROP COLUMN IF EXISTS composite_score;
