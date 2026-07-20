-- Migration: 006_watchlist_config.down.sql
-- Service: xstockstrat-config
-- Reverses 006_watchlist_config.up.sql — removes the seeded watchlist keys.

DELETE FROM config.config_values
 WHERE namespace = 'portfolio'
   AND key IN ('watchlist.max_per_user', 'watchlist.max_symbols_per_list');
