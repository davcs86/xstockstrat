-- key must equal the full-dotted string portfolio's Watcher.GetInt reads and value_type must be 'int',
-- or GetInt silently returns the code default; value_data must stay inside the [60,86400] write bounds.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('portfolio', 'portfolio.watchlist.signal_prune_interval_seconds', 'int', '300',
   'Portfolio signal-watchlist prune: seconds between expiry prune ticks, read live each iteration. A stored value <=0 reads as 300, 1-59 as 60, above 86400 as 86400. Raising it is not a pause.',
   '300', 'xstockstrat-portfolio', 'staging', NULL),
  ('portfolio', 'portfolio.watchlist.signal_prune_interval_seconds', 'int', '300',
   'Portfolio signal-watchlist prune: seconds between expiry prune ticks, read live each iteration. A stored value <=0 reads as 300, 1-59 as 60, above 86400 as 86400. Raising it is not a pause.',
   '300', 'xstockstrat-portfolio', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
