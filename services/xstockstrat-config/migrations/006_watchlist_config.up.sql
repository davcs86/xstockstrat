-- Migration: 006_watchlist_config.up.sql
-- Service: xstockstrat-config
-- Seeds the portfolio.watchlist.* config keys (feature 058) for dev + production.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('portfolio', 'watchlist.max_per_user', 'int', '50',
   'Max watchlists a single user may own',
   '50', 'xstockstrat-portfolio', 'dev', 'all'),
  ('portfolio', 'watchlist.max_per_user', 'int', '50',
   'Max watchlists a single user may own',
   '50', 'xstockstrat-portfolio', 'production', 'all'),
  ('portfolio', 'watchlist.max_symbols_per_list', 'int', '500',
   'Max symbols allowed in one watchlist',
   '500', 'xstockstrat-portfolio', 'dev', 'all'),
  ('portfolio', 'watchlist.max_symbols_per_list', 'int', '500',
   'Max symbols allowed in one watchlist',
   '500', 'xstockstrat-portfolio', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
