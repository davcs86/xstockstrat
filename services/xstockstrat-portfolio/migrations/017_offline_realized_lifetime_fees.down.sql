-- The positions.source backfill is intentionally not reverted: ORDERS is correct for those rows.
ALTER TABLE portfolio.offline_account_realized
    DROP COLUMN IF EXISTS recent_fills,
    DROP COLUMN IF EXISTS fees_carried,
    DROP COLUMN IF EXISTS fees_since_snapshot,
    DROP COLUMN IF EXISTS realized_carried;
