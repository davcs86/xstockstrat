-- feature 029 — per-position cumulative broker-fee accumulator, folded alongside realized_accum
-- (migration 010) on every reducing fill. NOT NULL DEFAULT 0 so existing rows read fee-free
-- (net == gross, AC-11); no backfill needed.
ALTER TABLE portfolio.positions
  ADD COLUMN IF NOT EXISTS fees_accum NUMERIC NOT NULL DEFAULT 0;
