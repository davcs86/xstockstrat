-- Migration: 011_watchlist_system_managed_source.up.sql
-- Service: xstockstrat-portfolio
-- Feature 127 (consolidate-watchlist-signal): adds the system-managed watchlist
-- flag and per-entry provenance. The system list is identified by the
-- system_managed flag (not by name), so it must coexist with a user's own
-- same-named manual list — the old UNIQUE (user_id, name) is reworked into a
-- partial unique index scoped to non-system lists, plus a one-system-list-per-user
-- partial unique index used as the race-safe ON CONFLICT target.
-- NNN is 011 (not 010): feature 042 keeps portfolio 010 per merge-order.md.

ALTER TABLE portfolio.watchlists
  ADD COLUMN system_managed BOOLEAN NOT NULL DEFAULT false;

-- The inline UNIQUE (user_id, name) from 007 is auto-named watchlists_user_id_name_key.
ALTER TABLE portfolio.watchlists
  DROP CONSTRAINT IF EXISTS watchlists_user_id_name_key;

-- Name uniqueness applies only to non-system lists; the system list's name is
-- cosmetic and may collide with a user's own same-named manual list (FR-7).
CREATE UNIQUE INDEX watchlists_user_name_not_system_uidx
  ON portfolio.watchlists (user_id, name)
  WHERE NOT system_managed;

-- Exactly one system-managed list per user; the ON CONFLICT (user_id) target for
-- the race-safe find-or-create in EnsureSignalWatchlist.
CREATE UNIQUE INDEX watchlists_user_system_uidx
  ON portfolio.watchlists (user_id)
  WHERE system_managed;

-- Per-entry provenance (WatchlistEntrySource enum value; 0 = unspecified→manual).
ALTER TABLE portfolio.watchlist_symbols
  ADD COLUMN source SMALLINT NOT NULL DEFAULT 0;
