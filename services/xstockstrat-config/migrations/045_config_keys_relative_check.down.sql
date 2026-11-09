-- Migration: 045_config_keys_relative_check.down.sql
ALTER TABLE config.config_values DROP CONSTRAINT IF EXISTS config_values_key_relative_check;
