-- Migration: 018_watchlist_signal_expiry.down.sql
-- Service: xstockstrat-portfolio — reverses 018 (the valid_until index drops with the table).

DROP TABLE IF EXISTS portfolio.watchlist_signal_expiry;
