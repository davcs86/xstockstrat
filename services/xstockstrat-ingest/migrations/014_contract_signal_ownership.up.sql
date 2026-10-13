-- contract-of: services/xstockstrat-ingest/migrations/013_signal_ownership_templates.up.sql
-- Migration: 014_contract_signal_ownership.up.sql (feature 225 contract of 013; replay-safe).

DROP TRIGGER IF EXISTS newsletter_signals_n1_owner_fill ON ingest.newsletter_signals;
DROP FUNCTION IF EXISTS ingest.n1_owner_fill_signals();
DROP TABLE IF EXISTS ingest.signal_dedup_keys;
