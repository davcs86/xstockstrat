-- Migration: 014_config_caller_identity.sql
-- Service: xstockstrat-config
-- Feature 102 (broker-state-reconciliation): a free-text author/reason alone can't distinguish
-- "an operator clicked Save" from "the reconciliation poller escalated" for incident review
-- (fails.md 2026-07-01) — a structural column an investigator can WHERE-filter on, not one they
-- must know to grep for. Populated only for an internal-caller SetConfig write
-- (x-internal-caller metadata); NULL for every ordinary human/admin write.
ALTER TABLE config.config_values
    ADD COLUMN IF NOT EXISTS caller_identity TEXT;

ALTER TABLE config.config_audit
    ADD COLUMN IF NOT EXISTS caller_identity TEXT;

-- Re-define both trigger functions (matching their real current definitions —
-- audit_config_change from 002_config_environment.up.sql:29-37, audit_config_insert from
-- 010_config_audit_insert_trigger.up.sql) to copy the new column through their existing named
-- column lists.
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
