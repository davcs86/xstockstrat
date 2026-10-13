-- Migration: 014_contract_signal_ownership.down.sql
DO $$ BEGIN
  RAISE EXCEPTION 'irreversible contract: ingest 014 dropped the N-1 owner-fill trigger/function and ingest.signal_dedup_keys; recover with migrate force 12 then db-migrate.sh up';
END $$;
