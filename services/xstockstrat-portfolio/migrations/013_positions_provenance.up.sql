-- Feature 163 (snapshot-offline-positions): add provenance columns to portfolio.positions.
-- source is the PositionSource enum integer (0=UNSPECIFIED); as_of is the baseline snapshot
-- effective date (NULL for ORDERS-only positions).

ALTER TABLE portfolio.positions ADD COLUMN IF NOT EXISTS source    INTEGER     NOT NULL DEFAULT 0;  -- PositionSource enum (0=UNSPECIFIED)
ALTER TABLE portfolio.positions ADD COLUMN IF NOT EXISTS as_of     TIMESTAMPTZ;                     -- NULL for ORDERS-only positions
