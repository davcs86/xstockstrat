-- Feature 328 (AC-1..AC-4): the operator sweep scripts/config-heal/mcp-credential-orphan-sweep.sql, run by
-- migration-rerun.py after pass 3. Every block is BEGIN ... ROLLBACK; every count is scoped to the sweep328-* seed users.

-- Block 1 (default grace, 24h): one conjunct protects each survivor; the owner join is exact.
BEGIN;
INSERT INTO ingest.signal_sources
  (user_id, slug, display_name, source_type, extractor_module, active, reliability_weight, credentials_ref)
VALUES
  ('sweep328-u',  'u-ref-a',  'U A',     'mcp_client', 'app.extractors.noop', TRUE, 1.0, 'ingest.mcp_credential.a'),
  ('sweep328-u',  'u-nodot',  'U nodot', 'mcp_client', 'app.extractors.noop', TRUE, 1.0, 'nodot'),
  ('sweep328-u',  'u-null',   'U null',  'mcp_client', 'app.extractors.noop', TRUE, 1.0, NULL),
  ('sweep328-u',  'u-empty',  'U empty', 'mcp_client', 'app.extractors.noop', TRUE, 1.0, ''),
  ('sweep328-v2', 'v2-ref-k', 'V2 K',    'mcp_client', 'app.extractors.noop', TRUE, 1.0, 'ingest.mcp_credential.k'),
  ('sweep328-v2', 'v2-ref-m', 'V2 M',    'mcp_client', 'app.extractors.noop', TRUE, 1.0, 'ingest.mcp_credential.m');
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, value_encrypted, is_secret, environment, user_id, updated_at)
VALUES
  ('ingest', 'mcp_credential.a',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.b',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.c',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now()),
  ('ingest', 'mcp_credential.g328',   'string', '[redacted]', '\x00', TRUE,  'staging', NULL,          now() - interval '25 hours'),
  ('ingest', 'mcp_credential.x',      'string', 'plain',      NULL,   FALSE, 'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('notify', 'mcp_credential.y',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcpXcredential.z',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.staged', 'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.k',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-u',  now() - interval '25 hours'),
  ('ingest', 'mcp_credential.a',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-v1', now() - interval '25 hours'),
  ('ingest', 'mcp_credential.m',      'string', '[redacted]', '\x00', TRUE,  'staging', 'sweep328-v2', now() - interval '25 hours');
\ir ../config-heal/mcp-credential-orphan-sweep.sql
\ir ../config-heal/mcp-credential-orphan-sweep.sql
DO $$
DECLARE
  survivors TEXT[];
  n_audit   INTEGER;
BEGIN
  SELECT array_agg(t.id ORDER BY t.id COLLATE "C") INTO survivors
    FROM (SELECT COALESCE(user_id, 'global') || '/' || namespace || '/' || key AS id
            FROM config.config_values
           WHERE user_id LIKE 'sweep328-%' OR (user_id IS NULL AND key = 'mcp_credential.g328')) t;
  IF survivors IS DISTINCT FROM ARRAY[
       'global/ingest/mcp_credential.g328',
       'sweep328-u/ingest/mcpXcredential.z',
       'sweep328-u/ingest/mcp_credential.a',
       'sweep328-u/ingest/mcp_credential.c',
       'sweep328-u/ingest/mcp_credential.x',
       'sweep328-u/notify/mcp_credential.y',
       'sweep328-v2/ingest/mcp_credential.m'] THEN
    RAISE EXCEPTION 'AC-1..AC-4: sweep survivors differ: %', survivors;
  END IF;
  SELECT count(*) INTO n_audit FROM config.config_audit
   WHERE changed_by = 'system:config-heal-mcp-credential-sweep' AND user_id LIKE 'sweep328-%'
     AND old_value = '[redacted]' AND new_value IS NULL;
  IF n_audit <> 4 THEN
    RAISE EXCEPTION 'AC-1: expected 4 sweep audit rows (one per delete, none from the second run), got %', n_audit;
  END IF;
END $$;
ROLLBACK;

-- Block 2: grace_hours=0 is floored to 1h.
BEGIN;
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, value_encrypted, is_secret, environment, user_id, updated_at)
VALUES
  ('ingest', 'mcp_credential.m30', 'string', '[redacted]', '\x00', TRUE, 'staging', 'sweep328-u', now() - interval '30 minutes'),
  ('ingest', 'mcp_credential.h2',  'string', '[redacted]', '\x00', TRUE, 'staging', 'sweep328-u', now() - interval '2 hours');
\set grace_hours 0
\ir ../config-heal/mcp-credential-orphan-sweep.sql
DO $$
DECLARE survivors TEXT[];
BEGIN
  SELECT array_agg(key ORDER BY key COLLATE "C") INTO survivors FROM config.config_values WHERE user_id LIKE 'sweep328-%';
  IF survivors IS DISTINCT FROM ARRAY['mcp_credential.m30'] THEN
    RAISE EXCEPTION 'grace floor: expected only the 30-minute orphan to survive grace_hours=0, got %', survivors;
  END IF;
END $$;
ROLLBACK;
