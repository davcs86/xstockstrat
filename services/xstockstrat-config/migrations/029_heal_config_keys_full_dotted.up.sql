-- Migration: 029_heal_config_keys_full_dotted.up.sql
-- Service: xstockstrat-config
-- Feature 189 (fix-trading-config-key-mismatch).
--
-- Heals namespace-relative (bare) `key` rows to the full-dotted CONFIG-9 contract so that consumers
-- which read the full-dotted `<namespace>.<key>` getter string (the trading/portfolio Go WatchConfig
-- watchers, and the /trader UI's GetConfig read) resolve the LIVE value instead of silently falling
-- back to the code default. The config server keys its WatchConfig/GetConfig snapshot by the raw
-- `key` column with no namespace prefix (configServiceImpl.ts reloadNamespace/resolveOverlayValues),
-- so the stored key must equal the consumer's exact getter string (constitution CONFIG-9). The
-- SEV-1 symptom was `platform.trading_state` (bare `trading_state`) never matching the reader's
-- `GetString("platform.trading_state", "HALTED")`, so trading was jammed at the fail-closed HALTED
-- default. No `value_type` is ever changed here (immutable once read — ledger fails.md:344-346).
--
-- No explicit BEGIN/COMMIT (matches 002/013/017 — relies on golang-migrate's per-migration wrapping).

-- 1. Guarded blanket heal: prefix the namespace onto any bare key in the four affected namespaces.
--    Guards:
--    - `key NOT LIKE namespace || '.%'` skips rows already stored full-dotted (e.g. analysis.engine.*,
--      portfolio.watchlist.max_per_user, marketdata.finnhub.*/fmp.*) so they are never double-prefixed.
--    - `is_secret = false` leaves the encrypted vendor-credential rows (marketdata alpaca/fmp/finnhub
--      API keys, seeded is_secret=TRUE by 017) bare — those resolve via the separate GetSecret RPC,
--      which passes namespace-relative keys and must stay bare (@AC-6/@AC-7).
UPDATE config.config_values
SET key = namespace || '.' || key
WHERE key NOT LIKE namespace || '.%'
  AND is_secret = false
  AND namespace IN ('platform', 'trading', 'portfolio', 'marketdata');

-- 2. Preserve current PRODUCTION bracket-protection behavior. Feature 030 seeded
--    trading.risk.bracket_orders_enabled = 'false' in production (013:12, "FALSE pending feature 103"),
--    but the broken key resolution meant the getter returned its code default `true`, so production
--    actually ran with bracket protection ON. Honoring the seed now (post-heal) would silently flip
--    protection OFF. The operator signed off (feature 189 design.md § Business Rules Touched /
--    context.md 2026-09-15) on preserving current behavior by bumping the production seed to 'true'.
--    Deterministic literal (retry-idempotent); targets the POST-RENAME full-dotted key; production +
--    global scope only. value_type ('bool') is unchanged.
UPDATE config.config_values
SET value_data = 'true'
WHERE namespace = 'trading'
  AND key = 'trading.risk.bracket_orders_enabled'
  AND environment = 'production'
  AND user_id IS NULL;
