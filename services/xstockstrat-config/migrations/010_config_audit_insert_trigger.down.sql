-- Revert feature 091's audit-on-create trigger. The BEFORE UPDATE trigger from 001 is untouched.
DROP TRIGGER IF EXISTS config_value_audit_insert ON config.config_values;
DROP FUNCTION IF EXISTS config.audit_config_insert();
