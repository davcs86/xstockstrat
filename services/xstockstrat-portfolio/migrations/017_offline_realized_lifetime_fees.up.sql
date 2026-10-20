-- Feature 230: lifetime realized carry, fees and the recent-fills window for offline accounts.
ALTER TABLE portfolio.offline_account_realized
    ADD COLUMN IF NOT EXISTS realized_carried    DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fees_since_snapshot DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fees_carried        DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS recent_fills        JSONB            NOT NULL DEFAULT '[]'::jsonb;

-- Pre-163 offline positions carry source 0; mark them ORDERS so the offline valuation path sees them.
UPDATE portfolio.positions SET source = 1
WHERE source = 0 AND account_id IN (SELECT account_id FROM portfolio.offline_account_realized);
