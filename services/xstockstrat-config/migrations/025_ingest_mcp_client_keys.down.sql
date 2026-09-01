-- Migration: 025_ingest_mcp_client_keys.down.sql
-- Service: xstockstrat-config
-- Reverse 025: remove the two seeded ingest.mcp_client.* loop keys (feature 166) across all
-- environments (global rows only, matching the seed's user_id NULL scope). Does NOT touch
-- ingest.mcp_credential.% — those per-source bearer secrets are written at registration, not seeded
-- here.

DELETE FROM config.config_values
WHERE namespace = 'ingest'
  AND key LIKE 'mcp_client.%';
