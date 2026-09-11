-- Migration: 015_watchlist_default_strategy.up.sql
-- Service: xstockstrat-portfolio
-- Adds the watchlist-level default strategy (feature 170). Applied to newly-added,
-- otherwise-unbound MANUAL symbols at add time only (no retroactive rebind, no
-- read-time fallback). '' = no default. Mirrors the additive 008 column pattern.

ALTER TABLE portfolio.watchlists
  ADD COLUMN IF NOT EXISTS default_strategy_id TEXT NOT NULL DEFAULT '';
