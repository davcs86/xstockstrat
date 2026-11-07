-- key must equal the full-dotted string portfolio's Watcher.GetInt reads and value_type must be 'int',
-- or GetInt silently returns the code default; value_data must stay inside the [500,4000] write bounds.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('portfolio', 'portfolio.marketdata.servability_timeout_ms', 'int', '2000',
   'Portfolio watchlist writes: deadline (ms) on the marketdata GetSymbolServability check, read live per write. A stored value <=0 reads as 2000, below 500 as 500, above 4000 as 4000. On timeout or error the write is let through with a WARN.',
   '2000', 'xstockstrat-portfolio', 'staging', NULL),
  ('portfolio', 'portfolio.marketdata.servability_timeout_ms', 'int', '2000',
   'Portfolio watchlist writes: deadline (ms) on the marketdata GetSymbolServability check, read live per write. A stored value <=0 reads as 2000, below 500 as 500, above 4000 as 4000. On timeout or error the write is let through with a WARN.',
   '2000', 'xstockstrat-portfolio', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
