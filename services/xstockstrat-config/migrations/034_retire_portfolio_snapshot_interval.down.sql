-- Migration: 034_retire_portfolio_snapshot_interval.down.sql
-- Service: xstockstrat-config
-- Feature 264: restore the dead portfolio.snapshot.interval_minutes key to its pre-deletion state —
-- both environment rows (001 seed renamed dev→staging by 017, value 5; 002 production seed, value 1),
-- post-029 full-dotted key, user_id NULL. Per-user overrides are not restored (accepted, as in 020).
-- NOTE: this hardcoded restore clobbers any live operator edit to value_data (inherent to a
-- hardcoded down-migration). Nothing reads this key, so the runtime impact is nil.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
  ('portfolio', 'portfolio.snapshot.interval_minutes', 'int', '5', FALSE, 'Portfolio snapshot frequency', '5', 'xstockstrat-portfolio', 'staging', NULL),
  ('portfolio', 'portfolio.snapshot.interval_minutes', 'int', '1', FALSE, 'Portfolio snapshot frequency (prod)', '1', 'xstockstrat-portfolio', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
