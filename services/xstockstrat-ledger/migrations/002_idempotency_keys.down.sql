-- Rollback: drop the idempotency dedup map.
DROP TABLE IF EXISTS ledger.idempotency_keys;
