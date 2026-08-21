-- Down migration for 017_config_secrets_and_scoping.
--
-- Reverses the scope re-model + encrypted-secret storage. Data is restored from the point-in-time
-- snapshot config.config_values_premigration_017 captured when the up-migration ran. NOTE: this is
-- a destructive-change down — config writes made AFTER 017 was applied (new per-user rows, secret
-- ciphertext set post-deploy, edits) are NOT preserved; the pre-017 state is restored faithfully.

-- 1. Drop the new (env, user) uniqueness + index.
DROP INDEX IF EXISTS config.config_values_scope_uniq;
DROP INDEX IF EXISTS config.idx_config_namespace_env_user;

-- 2. Re-add the trading_mode columns.
ALTER TABLE config.config_values
    ADD COLUMN IF NOT EXISTS trading_mode TEXT NOT NULL DEFAULT 'all'
        CHECK (trading_mode IN ('paper', 'live', 'all'));
ALTER TABLE config.config_audit
    ADD COLUMN IF NOT EXISTS trading_mode TEXT;

-- 3. Drop the 017 environment CHECK (re-added with the pre-017 domain after the data restore).
ALTER TABLE config.config_values DROP CONSTRAINT IF EXISTS config_values_environment_check;

-- 4. Restore the pre-017 audit trigger functions (feature 014 versions — reference trading_mode).
CREATE OR REPLACE FUNCTION config.audit_config_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.value_data IS DISTINCT FROM NEW.value_data THEN
        INSERT INTO config.config_audit
            (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode, caller_identity)
        VALUES
            (NEW.namespace, NEW.key, OLD.value_data, NEW.value_data, NEW.updated_by, NEW.update_reason,
             NEW.environment, NEW.trading_mode, NEW.caller_identity);
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION config.audit_config_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO config.config_audit
        (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode, caller_identity)
    VALUES
        (NEW.namespace, NEW.key, NULL, NEW.value_data, NEW.updated_by, NEW.update_reason,
         NEW.environment, NEW.trading_mode, NEW.caller_identity);
    RETURN NEW;
END;
$$;

-- 5. Drop the 017 columns so config_values matches the pre-017 shape, then restore the data.
ALTER TABLE config.config_values DROP COLUMN IF EXISTS value_encrypted;
ALTER TABLE config.config_values DROP COLUMN IF EXISTS user_id;
ALTER TABLE config.config_audit  DROP COLUMN IF EXISTS user_id;

TRUNCATE config.config_values;
INSERT INTO config.config_values
    (id, namespace, key, value_type, value_data, is_secret, description, default_value,
     consuming_service, updated_by, update_reason, created_at, updated_at, environment,
     trading_mode, caller_identity)
SELECT
     id, namespace, key, value_type, value_data, is_secret, description, default_value,
     consuming_service, updated_by, update_reason, created_at, updated_at, environment,
     trading_mode, caller_identity
FROM config.config_values_premigration_017;

SELECT setval(pg_get_serial_sequence('config.config_values', 'id'),
              COALESCE((SELECT MAX(id) FROM config.config_values), 1));

-- 6. Re-add the pre-017 (namespace, key, environment, trading_mode) uniqueness + index.
ALTER TABLE config.config_values
    ADD CONSTRAINT config_values_namespace_key_env_mode_key
        UNIQUE (namespace, key, environment, trading_mode);
CREATE INDEX IF NOT EXISTS idx_config_namespace_env_mode
    ON config.config_values (namespace, environment, trading_mode);

-- 7. Re-add the pre-017 environment CHECK (dev/production).
ALTER TABLE config.config_values
    ADD CONSTRAINT config_values_environment_check CHECK (environment IN ('dev', 'production'));

-- 8. Drop the snapshot table.
DROP TABLE IF EXISTS config.config_values_premigration_017;
