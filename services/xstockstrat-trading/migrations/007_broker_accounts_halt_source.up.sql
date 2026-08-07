-- Migration: 007_broker_accounts_halt_source.sql
-- Service: xstockstrat-trading
-- Feature 102 (broker-state-reconciliation): adds the halt_source discriminator on top of
-- feature 030's halted/halted_at/halt_reason columns (005_broker_accounts_halted.up.sql), so an
-- operator can tell which automated mechanism (030's bracket-protection flatten failure, or
-- 102's reconciliation mismatch) triggered a given halt. Maps to the HaltSource proto enum:
-- 0=UNSPECIFIED, 1=BRACKET_PROTECTION, 2=RECONCILIATION.
ALTER TABLE trading.broker_accounts
    ADD COLUMN IF NOT EXISTS halt_source SMALLINT NOT NULL DEFAULT 0;
