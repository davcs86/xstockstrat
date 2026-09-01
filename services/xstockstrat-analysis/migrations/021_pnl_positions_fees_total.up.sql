-- feature 029 — sealed per-position total fees (net = realized_pnl - fees_total), plus the
-- (user_id, closed_at) range index GetAttribution scans. NOT NULL DEFAULT 0 so legacy closes with
-- no fees_total payload key read 0 (net == gross, AC-11); realized_pnl stays gross/unchanged.
ALTER TABLE analysis.pnl_positions
  ADD COLUMN IF NOT EXISTS fees_total NUMERIC NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_pnl_positions_user_closed
  ON analysis.pnl_positions (user_id, closed_at);
