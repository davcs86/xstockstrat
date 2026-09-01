-- Migration: 025_ingest_mcp_client_keys.up.sql
-- Service: xstockstrat-config
-- Seeds the two non-secret ingest.mcp_client.* loop keys (feature 166, mcp-client-signal-source) for
-- staging + production.
--
-- NNN is the pre-assigned 025 (docs/roadmap/features/merge-order.md § Config-service seed-migration
-- pre-assignment: 021→022, 031→023, 168→024, 166→025). The working-tree tip is 022_ledger_export_keys,
-- so 025 MUST merge AFTER 022/023/024 — golang-migrate applies in strict numeric order and refuses a
-- migration numbered below the DB's current version. This is a cross-feature merge-order dependency
-- (not a code dependency): the loop reads both keys with code defaults 300/30, so it runs even before
-- this migration applies.
--
-- The `key` column is NAMESPACE-RELATIVE (`mcp_client.poll_interval_seconds`, NOT
-- `ingest.mcp_client...`): the ingest ConfigWatcher(namespace='ingest') reads get_int(key) against the
-- WatchConfig snapshot, which is keyed by the `key` column with no namespace prefix added (mirrors
-- 005_ingest_backfill_chunking's ('ingest','backfill.chunk_max_bars',…) and Step 10's
-- get_int('mcp_client.poll_interval_seconds', 300)). value_type 'int' must match the reader's get_int
-- getter or the value silently returns the default (migration-016 value_type trap).
--
-- The per-source bearer secret ingest.mcp_credential.<slug> is NOT seeded here — it is written at
-- registration via SetConfig(is_secret=true, create_key=true) (agent + config-ui two-write), never a
-- seed row. Scope (post feature 147): global (user_id NULL), one row per environment; is_secret stays
-- the column default FALSE (mirrors 021_notify_push_min_severity, same batch).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('ingest', 'mcp_client.poll_interval_seconds', 'int', '300',
   'Server-side MCP query loop cadence (seconds) for mcp_client signal sources (feature 166). Clamped to >=1 at read so a settable 0 cannot busy-loop. Default 300.',
   '300', 'xstockstrat-ingest', 'staging', NULL),
  ('ingest', 'mcp_client.poll_interval_seconds', 'int', '300',
   'Server-side MCP query loop cadence (seconds) for mcp_client signal sources (feature 166). Clamped to >=1 at read so a settable 0 cannot busy-loop. Default 300.',
   '300', 'xstockstrat-ingest', 'production', NULL),
  ('ingest', 'mcp_client.request_timeout_seconds', 'int', '30',
   'Per-call outbound MCP request timeout (seconds) for mcp_client signal sources (feature 166). Clamped to >=1 at read. Default 30.',
   '30', 'xstockstrat-ingest', 'staging', NULL),
  ('ingest', 'mcp_client.request_timeout_seconds', 'int', '30',
   'Per-call outbound MCP request timeout (seconds) for mcp_client signal sources (feature 166). Clamped to >=1 at read. Default 30.',
   '30', 'xstockstrat-ingest', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
