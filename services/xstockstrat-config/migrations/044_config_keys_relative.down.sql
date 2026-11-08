-- Migration: 044_config_keys_relative.down.sql
-- Irreversible contract: recover with `migrate force 43` and a data repair, never by editing 044.
DO $$ BEGIN
  RAISE EXCEPTION 'irreversible contract: feature 296 renamed config keys to namespace-relative';
END $$;
