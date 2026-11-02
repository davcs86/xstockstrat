-- Migration: 034_retire_portfolio_snapshot_interval.up.sql
-- Service: xstockstrat-config
-- Feature 264: delete the dead portfolio.snapshot.interval_minutes config key. Its only reader,
-- StartSnapshotWriter, had zero callers and was deleted. Covers every environment and user_id, and
-- both stored key forms (029 rewrote bare keys to namespace-prefixed).
DELETE FROM config.config_values
WHERE namespace = 'portfolio'
  AND key IN ('portfolio.snapshot.interval_minutes', 'snapshot.interval_minutes');
