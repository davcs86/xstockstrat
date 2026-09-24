-- Migration: 024_opportunity_composite_score.up.sql
-- Service: xstockstrat-analysis
-- feature 199 — nullable composite ranking ordinal per opportunity row. NULLABLE with NO DEFAULT:
-- NULL is the honest "not yet computed / nothing to fuse" state (@AC-10/@AC-11/@AC-12), distinct
-- from a computed neutral 0.5. Additive to the feature-011 table; conviction/signal_axis untouched.
ALTER TABLE analysis.opportunities ADD COLUMN IF NOT EXISTS composite_score DOUBLE PRECISION;
