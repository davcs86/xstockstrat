-- Run by the DBA as an admin, once per environment. Replace :env (staging) and set the password
-- out of band; the role must stay non-superuser with no write privilege (startup asserts this).
CREATE ROLE xstockstrat_staging_smoke_ro LOGIN PASSWORD :'smoke_ro_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2;
ALTER ROLE xstockstrat_staging_smoke_ro SET default_transaction_read_only = on;
ALTER ROLE xstockstrat_staging_smoke_ro SET statement_timeout = '5s';

GRANT CONNECT ON DATABASE "xstockstrat-staging" TO xstockstrat_staging_smoke_ro;

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['config','ledger','identity','marketdata','trading','portfolio',
                           'notify','ingest','indicators','analysis']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO xstockstrat_staging_smoke_ro', s);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO xstockstrat_staging_smoke_ro', s);
    END IF;
  END LOOP;
END $$;

-- identity.* holds credential material; checks read it only through RPCs.
REVOKE SELECT ON ALL TABLES IN SCHEMA identity FROM xstockstrat_staging_smoke_ro;
-- Secret ciphertext is never readable: replace the table grant with a column grant minus value_encrypted.
REVOKE SELECT ON config.config_values FROM xstockstrat_staging_smoke_ro;
DO $$
BEGIN
  EXECUTE format('GRANT SELECT (%s) ON config.config_values TO xstockstrat_staging_smoke_ro',
    (SELECT string_agg(quote_ident(column_name), ', ') FROM information_schema.columns
      WHERE table_schema = 'config' AND table_name = 'config_values'
        AND column_name <> 'value_encrypted'));
END $$;
