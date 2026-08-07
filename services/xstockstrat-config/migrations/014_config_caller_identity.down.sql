CREATE OR REPLACE FUNCTION config.audit_config_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.value_data IS DISTINCT FROM NEW.value_data THEN
        INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode)
        VALUES (NEW.namespace, NEW.key, OLD.value_data, NEW.value_data, NEW.updated_by, NEW.update_reason, NEW.environment, NEW.trading_mode);
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION config.audit_config_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode)
    VALUES (NEW.namespace, NEW.key, NULL, NEW.value_data, NEW.updated_by, NEW.update_reason, NEW.environment, NEW.trading_mode);
    RETURN NEW;
END;
$$;

ALTER TABLE config.config_audit DROP COLUMN IF EXISTS caller_identity;
ALTER TABLE config.config_values DROP COLUMN IF EXISTS caller_identity;
