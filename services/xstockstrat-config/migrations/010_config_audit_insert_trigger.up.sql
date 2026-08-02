-- Feature 091 (fix-mcp-config-key-registry): audit key CREATION.
--
-- The existing config_value_audit trigger is BEFORE UPDATE only (001_config_tables.up.sql),
-- so a key INSERT (a create_key=true SetConfig, or a seed) writes no audit row. This adds a
-- DEDICATED AFTER INSERT trigger so creation is auditable with author + value in one row.
--
-- Why AFTER INSERT (not widening the BEFORE UPDATE trigger to BEFORE INSERT OR UPDATE):
-- setConfig writes via INSERT ... ON CONFLICT DO UPDATE. A widened trigger would double-fire on
-- the update path (the BEFORE INSERT arm fires for every proposed row, writing a phantom
-- old_value=NULL "creation" row, PLUS the BEFORE UPDATE arm). AFTER INSERT fires ONLY for rows
-- actually inserted (the conflict/update path does not fire it), so creation is audited exactly
-- once and the existing BEFORE UPDATE trigger is left completely untouched.
--
-- A dedicated function (not a reuse of audit_config_change) avoids that function's
-- NEW.updated_at mutation, which is invalid in an AFTER trigger.

CREATE OR REPLACE FUNCTION config.audit_config_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO config.config_audit (namespace, key, old_value, new_value, changed_by, reason, environment, trading_mode)
    VALUES (NEW.namespace, NEW.key, NULL, NEW.value_data, NEW.updated_by, NEW.update_reason, NEW.environment, NEW.trading_mode);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS config_value_audit_insert ON config.config_values;
CREATE TRIGGER config_value_audit_insert
    AFTER INSERT ON config.config_values
    FOR EACH ROW EXECUTE FUNCTION config.audit_config_insert();
