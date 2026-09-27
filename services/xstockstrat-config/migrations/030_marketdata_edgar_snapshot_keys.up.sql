-- Migration: 030_marketdata_edgar_snapshot_keys.up.sql
-- Service: xstockstrat-config
-- Seeds the 5 EDGAR-snapshot + dividend config keys for xstockstrat-marketdata (feature 211),
-- staging + production, global scope (user_id NULL).
--
-- Each row is seeded at its CURRENT code default so applying this migration is a NO-runtime-behavior
-- change: snapshot_source='vendor' keeps the existing FMP/Finnhub serving path (the live-flip to
-- 'edgar' is a rollout step, not this migration), dividends.enabled='false' means the Alpaca
-- corporate-actions fetch never runs at deploy (flipped on at rollout once the entitlement is
-- confirmed — Open Risk 2), and edgar.enabled='true' matches the service's explicit true default.
--
-- The `key` column carries the FULL dotted key the marketdata service reads (GetString/GetBool/GetInt
-- on "marketdata.*"): the WatchConfig snapshot is keyed by `key` with no namespace prefix added
-- (configServiceImpl.ts values[row.key]), so the seeded key must equal the read string. Mirrors
-- 026/027/028's authoritative full-dotted form.
-- `value_type` must match each getter's storage type or the value silently returns the default:
-- bool for .enabled, int for .cache_ttl_hours / .backfill_lookback_years, string for .snapshot_source.
--
-- These keys are NON-secret (is_secret absent/false) — plain operational toggles, resolved via
-- WatchConfig, unlike the encrypted marketdata.*.api_key credential rows (feature 147).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('marketdata', 'marketdata.fundamentals.snapshot_source', 'string', 'vendor',
   'Live-read serving source for the latest-fundamentals snapshot RPCs (feature 211): "edgar" derives the snapshot from the latest as-reported SEC filing + a live price; "vendor" is the FMP/Finnhub path. Seeded vendor (no serving change at deploy); the live-flip to edgar is the rollout. Unrecognized value → WARN + fail-safe to vendor.',
   'vendor', 'xstockstrat-marketdata', 'staging', NULL),
  ('marketdata', 'marketdata.fundamentals.snapshot_source', 'string', 'vendor',
   'Live-read serving source for the latest-fundamentals snapshot RPCs (feature 211): "edgar" derives the snapshot from the latest as-reported SEC filing + a live price; "vendor" is the FMP/Finnhub path. Seeded vendor (no serving change at deploy); the live-flip to edgar is the rollout. Unrecognized value → WARN + fail-safe to vendor.',
   'vendor', 'xstockstrat-marketdata', 'production', NULL),
  ('marketdata', 'marketdata.edgar.enabled', 'bool', 'true',
   'Kill switch for the EDGAR-canonical snapshot source (feature 211), read only under snapshot_source=edgar. Default ON (matches the service explicit true default — the feature-100 GetBool zero-value trap); false ⇒ FailedPrecondition (deliberate all-off).',
   'true', 'xstockstrat-marketdata', 'staging', NULL),
  ('marketdata', 'marketdata.edgar.enabled', 'bool', 'true',
   'Kill switch for the EDGAR-canonical snapshot source (feature 211), read only under snapshot_source=edgar. Default ON (matches the service explicit true default — the feature-100 GetBool zero-value trap); false ⇒ FailedPrecondition (deliberate all-off).',
   'true', 'xstockstrat-marketdata', 'production', NULL),
  ('marketdata', 'marketdata.edgar.cache_ttl_hours', 'int', '24',
   'Hours an EDGAR snapshot cache row (marketdata.fundamentals, source=edgar) stays fresh before re-derivation (feature 211). Mirrors the marketdata.fmp/finnhub.cache_ttl_hours convention.',
   '24', 'xstockstrat-marketdata', 'staging', NULL),
  ('marketdata', 'marketdata.edgar.cache_ttl_hours', 'int', '24',
   'Hours an EDGAR snapshot cache row (marketdata.fundamentals, source=edgar) stays fresh before re-derivation (feature 211). Mirrors the marketdata.fmp/finnhub.cache_ttl_hours convention.',
   '24', 'xstockstrat-marketdata', 'production', NULL),
  ('marketdata', 'marketdata.dividends.enabled', 'bool', 'false',
   'Master gate for the Alpaca cash-dividend corporate-actions feed backing the PIT T12M dividend yield (feature 211, FR-4). Seeded OFF so the migration triggers no unexpected Alpaca corporate-actions cost; flip on at rollout after the account entitlement is verified (Open Risk 2). Disabled/absent/unentitled ⇒ dividend_yield left missing, never a fabricated 0.',
   'false', 'xstockstrat-marketdata', 'staging', NULL),
  ('marketdata', 'marketdata.dividends.enabled', 'bool', 'false',
   'Master gate for the Alpaca cash-dividend corporate-actions feed backing the PIT T12M dividend yield (feature 211, FR-4). Seeded OFF so the migration triggers no unexpected Alpaca corporate-actions cost; flip on at rollout after the account entitlement is verified (Open Risk 2). Disabled/absent/unentitled ⇒ dividend_yield left missing, never a fabricated 0.',
   'false', 'xstockstrat-marketdata', 'production', NULL),
  ('marketdata', 'marketdata.dividends.backfill_lookback_years', 'int', '2',
   'Fetch-range bound (years back from now) for the Alpaca cash-dividend feed (feature 211). Bounds only how far back dividends are fetched; the T12M yield window itself is fixed at 365 days in code. Matches the service default.',
   '2', 'xstockstrat-marketdata', 'staging', NULL),
  ('marketdata', 'marketdata.dividends.backfill_lookback_years', 'int', '2',
   'Fetch-range bound (years back from now) for the Alpaca cash-dividend feed (feature 211). Bounds only how far back dividends are fetched; the T12M yield window itself is fixed at 365 days in code. Matches the service default.',
   '2', 'xstockstrat-marketdata', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
