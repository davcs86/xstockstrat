-- Migration: 017_config_secrets_and_scoping.up.sql
-- Service: xstockstrat-config
-- Feature 147 (config-secrets-and-scoping).
--
-- Re-models config scope from (environment dev/production) x (trading_mode paper/live/all) to the
-- two dimensions (environment production/staging) x (global/per-user user_id). paper/live is now
-- DERIVED from environment (production=live, staging=paper), so trading_mode ceases to be a config
-- axis. Also adds encrypted-at-rest secret storage: a secret row's plaintext lives ONLY in the new
-- value_encrypted BYTEA column (AES-256-GCM, written by the config service), while value_data holds
-- the literal '[redacted]' sentinel so every legacy value_data reader (incl. the audit triggers)
-- gets the sentinel for free and never the plaintext.
--
-- trading_mode-row COLLAPSE (FR-10, deterministic, no silent loss): every pre-migration row is first
-- copied into config.config_values_premigration_017 (a faithful-down + audit snapshot). Then, per
-- (namespace, key, environment), the surviving row is the one whose trading_mode matches the
-- environment's derived mode, else 'all', else the opposite mode:
--   production  ->  prefer live  > all > paper
--   staging     ->  prefer paper > all > live
-- The losing rows are deleted. Example (AC-12): production with both ('live'='HALTED') and
-- ('all'='ACTIVE') collapses to 'HALTED' (live matches production). Discarded values remain
-- inspectable in config.config_values_premigration_017.

-- 1. New columns.
ALTER TABLE config.config_values
    ADD COLUMN IF NOT EXISTS value_encrypted BYTEA,
    ADD COLUMN IF NOT EXISTS user_id         TEXT;      -- NULL = global scope
ALTER TABLE config.config_audit
    ADD COLUMN IF NOT EXISTS user_id         TEXT;

-- 2. Faithful-down + audit snapshot of the pre-collapse state (includes trading_mode + old env).
DROP TABLE IF EXISTS config.config_values_premigration_017;
CREATE TABLE config.config_values_premigration_017 AS
    SELECT * FROM config.config_values;

-- 3. Environment rename dev -> staging. Drop the old CHECK first (it forbids 'staging'), rename,
--    then add the new CHECK.
ALTER TABLE config.config_values DROP CONSTRAINT IF EXISTS config_values_environment_check;
UPDATE config.config_values SET environment = 'staging' WHERE environment = 'dev';
UPDATE config.config_audit  SET environment = 'staging' WHERE environment = 'dev';
ALTER TABLE config.config_values
    ADD CONSTRAINT config_values_environment_check CHECK (environment IN ('staging', 'production'));

-- 4. trading_mode collapse: keep exactly one row per (namespace, key, environment).
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY namespace, key, environment
               ORDER BY CASE
                   WHEN environment = 'production' AND trading_mode = 'live'  THEN 0
                   WHEN environment = 'production' AND trading_mode = 'all'   THEN 1
                   WHEN environment = 'production' AND trading_mode = 'paper' THEN 2
                   WHEN environment = 'staging'    AND trading_mode = 'paper' THEN 0
                   WHEN environment = 'staging'    AND trading_mode = 'all'   THEN 1
                   WHEN environment = 'staging'    AND trading_mode = 'live'  THEN 2
                   ELSE 3
               END, id
           ) AS rn
    FROM config.config_values
)
DELETE FROM config.config_values c
    USING ranked r
    WHERE c.id = r.id AND r.rn > 1;

-- 5. Rewrite both audit trigger functions to carry user_id instead of trading_mode BEFORE the
--    columns are dropped (a trigger firing mid-migration must not reference a dropped column).
CREATE OR REPLACE FUNCTION config.audit_config_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.value_data IS DISTINCT FROM NEW.value_data THEN
        INSERT INTO config.config_audit
            (namespace, key, old_value, new_value, changed_by, reason, environment, user_id, caller_identity)
        VALUES
            (NEW.namespace, NEW.key, OLD.value_data, NEW.value_data, NEW.updated_by, NEW.update_reason,
             NEW.environment, NEW.user_id, NEW.caller_identity);
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION config.audit_config_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO config.config_audit
        (namespace, key, old_value, new_value, changed_by, reason, environment, user_id, caller_identity)
    VALUES
        (NEW.namespace, NEW.key, NULL, NEW.value_data, NEW.updated_by, NEW.update_reason,
         NEW.environment, NEW.user_id, NEW.caller_identity);
    RETURN NEW;
END;
$$;

-- 6. Drop the trading_mode scoping (constraint + index + columns), add the new user-scoped uniqueness.
ALTER TABLE config.config_values DROP CONSTRAINT IF EXISTS config_values_namespace_key_env_mode_key;
DROP INDEX IF EXISTS config.idx_config_namespace_env_mode;
ALTER TABLE config.config_values DROP COLUMN IF EXISTS trading_mode;
ALTER TABLE config.config_audit  DROP COLUMN IF EXISTS trading_mode;

-- Global rows have user_id NULL; per-user overrides carry the user's id. COALESCE keeps the
-- (namespace,key,environment) global row unique alongside any per-user rows.
CREATE UNIQUE INDEX config_values_scope_uniq
    ON config.config_values (namespace, key, environment, COALESCE(user_id, ''));
CREATE INDEX IF NOT EXISTS idx_config_namespace_env_user
    ON config.config_values (namespace, environment, COALESCE(user_id, ''));

-- 7. Seed the four vendor-credential secret rows for both environments, global scope. Ciphertext is
--    NULL (a SQL migration has no master key); the operator sets the real value post-deploy via
--    SetConfig, which encrypts. A NULL-ciphertext secret resolves via GetSecret as found=false, so
--    marketdata sees empty creds and takes its existing warn-and-start path.
INSERT INTO config.config_values
    (namespace, key, value_type, value_data, is_secret, description, default_value, consuming_service, environment, user_id)
VALUES
    ('marketdata', 'alpaca.api_key',    'string', '[redacted]', TRUE, 'Alpaca API key (encrypted secret; set post-deploy via SetConfig)',    '', 'xstockstrat-marketdata', 'staging',    NULL),
    ('marketdata', 'alpaca.api_key',    'string', '[redacted]', TRUE, 'Alpaca API key (encrypted secret; set post-deploy via SetConfig)',    '', 'xstockstrat-marketdata', 'production', NULL),
    ('marketdata', 'alpaca.api_secret', 'string', '[redacted]', TRUE, 'Alpaca API secret (encrypted secret; set post-deploy via SetConfig)', '', 'xstockstrat-marketdata', 'staging',    NULL),
    ('marketdata', 'alpaca.api_secret', 'string', '[redacted]', TRUE, 'Alpaca API secret (encrypted secret; set post-deploy via SetConfig)', '', 'xstockstrat-marketdata', 'production', NULL),
    ('marketdata', 'fmp.api_key',       'string', '[redacted]', TRUE, 'FMP API key (encrypted secret; set post-deploy via SetConfig)',       '', 'xstockstrat-marketdata', 'staging',    NULL),
    ('marketdata', 'fmp.api_key',       'string', '[redacted]', TRUE, 'FMP API key (encrypted secret; set post-deploy via SetConfig)',       '', 'xstockstrat-marketdata', 'production', NULL),
    ('marketdata', 'finnhub.api_key',   'string', '[redacted]', TRUE, 'Finnhub API key (encrypted secret; set post-deploy via SetConfig)',   '', 'xstockstrat-marketdata', 'staging',    NULL),
    ('marketdata', 'finnhub.api_key',   'string', '[redacted]', TRUE, 'Finnhub API key (encrypted secret; set post-deploy via SetConfig)',   '', 'xstockstrat-marketdata', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
