-- Migration: 025_opportunity_symbol_score.up.sql
-- Service: xstockstrat-analysis
-- feature 200 — nullable symbol-level roll-up score per opportunity row. NULLABLE with NO DEFAULT:
-- NULL = no score-eligible opportunity for the symbol (all composites NULL), distinct from a
-- computed value. Symbol-uniform (every row of a symbol carries the same value). Additive to the
-- feature-011 table; conviction/signal_axis/composite_score untouched. No index — the symbol_score
-- sort computes MAX(symbol_score) OVER (PARTITION BY o.symbol) over the already-user-scoped read.
ALTER TABLE analysis.opportunities ADD COLUMN IF NOT EXISTS symbol_score DOUBLE PRECISION;
