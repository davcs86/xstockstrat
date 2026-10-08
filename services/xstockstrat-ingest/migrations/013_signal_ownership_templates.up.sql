-- requires-env: SEED_USER_ID
-- Migration: 013_signal_ownership_templates.up.sql
-- Service: xstockstrat-ingest
-- feature 224 (release N, expand-only). Must stay idempotent on the expanded AND the contracted schema:
-- db-migrate.sh dirty recovery replays from 001. Prod has zero mcp_client sources, so no credential_scope.

DO $$
DECLARE
  seed TEXT := '${SEED_USER_ID}';
BEGIN
  IF seed IS NULL OR seed = '' OR seed LIKE '%$' || '{%' THEN
    RAISE EXCEPTION 'migration 013: SEED_USER_ID is unset/unrendered (got "%")', seed;
  END IF;
END $$;

-- One-shot on signal_sources.user_id absence: the N-1 trigger must never be re-created after the
-- contract migration drops it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ingest' AND table_name = 'signal_sources' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE ingest.signal_sources ADD COLUMN user_id TEXT;

    -- D-4: derived (fundamentals producer) sources belong to 'system'; every other legacy source to the seed.
    UPDATE ingest.signal_sources SET user_id = 'system' WHERE source_type = 'derived';
    UPDATE ingest.signal_sources SET user_id = '${SEED_USER_ID}' WHERE user_id IS NULL;

    ALTER TABLE ingest.signal_sources ALTER COLUMN user_id SET NOT NULL;
    ALTER TABLE ingest.signal_sources DROP CONSTRAINT signal_sources_pkey;
    ALTER TABLE ingest.signal_sources ADD PRIMARY KEY (user_id, slug);

    -- N-1 inserts carry no user_id: fill the unique slug holder, else fail closed (never the seed user).
    CREATE OR REPLACE FUNCTION ingest.n1_owner_fill_signals() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    DECLARE
      holders INTEGER;
      holder  TEXT;
    BEGIN
      IF NEW.user_id IS NULL THEN
        SELECT count(*), min(s.user_id) INTO holders, holder
          FROM ingest.signal_sources s
         WHERE s.slug = NEW.source;
        IF holders <> 1 THEN
          RAISE EXCEPTION 'n1_owner_fill: source "%" has % owners; cannot infer user_id', NEW.source, holders;
        END IF;
        NEW.user_id := holder;
      END IF;
      RETURN NEW;
    END
    $fn$;

    CREATE TRIGGER newsletter_signals_n1_owner_fill
      BEFORE INSERT ON ingest.newsletter_signals
      FOR EACH ROW EXECUTE FUNCTION ingest.n1_owner_fill_signals();
  END IF;
END $$;

-- One-shot on newsletter_signals.user_id absence; the constant default is a fast default (no chunk rewrite).
DO $$
DECLARE
  total_rows  BIGINT;
  system_rows BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'ingest' AND table_name = 'newsletter_signals' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE ingest.newsletter_signals ADD COLUMN user_id TEXT NOT NULL DEFAULT '${SEED_USER_ID}';

    UPDATE ingest.newsletter_signals
       SET user_id = 'system'
     WHERE source IN (SELECT slug FROM ingest.signal_sources WHERE user_id = 'system');
    GET DIAGNOSTICS system_rows = ROW_COUNT;

    ALTER TABLE ingest.newsletter_signals ALTER COLUMN user_id DROP DEFAULT;

    SELECT count(*) INTO total_rows FROM ingest.newsletter_signals;
    RAISE NOTICE 'migration 013: newsletter_signals backfilled: % rows total, % assigned to system',
      total_rows, system_rows;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_newsletter_signals_owner_ingested
    ON ingest.newsletter_signals (user_id, ingested_at DESC);

CREATE TABLE IF NOT EXISTS ingest.signal_dedup_claims (
    user_id     TEXT        NOT NULL,
    source      TEXT        NOT NULL,
    symbol      TEXT        NOT NULL,
    direction   TEXT        NOT NULL,
    conviction  NUMERIC(4,3),
    valid_until TIMESTAMPTZ,
    signal_id   BIGINT      NOT NULL,
    claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, source, symbol, direction)
);
CREATE INDEX IF NOT EXISTS idx_signal_dedup_claims_claimed_at ON ingest.signal_dedup_claims (claimed_at);

-- The contract drops signal_dedup_keys, so the read is to_regclass-guarded.
DO $$
BEGIN
  IF to_regclass('ingest.signal_dedup_keys') IS NOT NULL THEN
    INSERT INTO ingest.signal_dedup_claims
        (user_id, source, symbol, direction, conviction, valid_until, signal_id, claimed_at)
    SELECT n.user_id, k.source, k.symbol, k.direction, k.conviction, k.valid_until, k.signal_id, k.claimed_at
      FROM ingest.signal_dedup_keys k
      JOIN ingest.newsletter_signals n ON n.id = k.signal_id
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

ALTER TABLE ingest.signal_sources
    ADD COLUMN IF NOT EXISTS origin_template_id      TEXT,
    ADD COLUMN IF NOT EXISTS origin_template_version INTEGER;

-- No seed rows (AC-15): templates are authored by admins at runtime.
CREATE TABLE IF NOT EXISTS ingest.source_templates (
    template_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    payload     JSONB NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    retired_at  TIMESTAMP WITH TIME ZONE,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
