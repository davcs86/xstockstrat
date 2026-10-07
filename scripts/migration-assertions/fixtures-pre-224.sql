-- Pre-feature-224 rows, loaded by migration-rerun.sh at indicators 006 / ingest 012 / analysis 025.
-- Not an assertion file: migration-rerun.sh skips fixtures-* in its assertion loop.

CREATE SCHEMA fixture_pre224;

-- indicators @006: 8 public formulas; the snapshot lets indicators-007.sql prove no row was lost or rewritten.
INSERT INTO indicators.formulas (formula_id, name, source, author, is_public)
SELECT ('00000000-0000-4000-8224-' || lpad(i::text, 12, '0'))::uuid,
       'fixture formula ' || i,
       'result = close * ' || i,
       (ARRAY['user-a@example.test', 'user-b@example.test', 'system'])[1 + i % 3],
       TRUE
  FROM generate_series(1, 8) AS i;

CREATE TABLE fixture_pre224.formulas AS
SELECT formula_id, source, author FROM indicators.formulas;

-- ingest @012: two user-registered sources plus the derived fundamentals producer source.
INSERT INTO ingest.signal_sources (slug, display_name, source_type, extractor_module)
VALUES ('fixture-newsletter', 'Fixture Newsletter', 'simple_email', 'app.extractors.noop'),
       ('fixture-website', 'Fixture Website', 'simple_website', 'app.extractors.noop'),
       ('fundamentals', 'Fundamentals Signal Producer', 'derived', 'app.extractors.noop');

-- 120 signals (40 per source), each with a unique symbol so every one owns a dedup key.
INSERT INTO ingest.newsletter_signals
    (id, ingested_at, source, symbol, direction, conviction, valid_from, valid_until)
SELECT 822400000 + i,
       NOW() - make_interval(hours => i),
       (ARRAY['fixture-newsletter', 'fixture-website', 'fundamentals'])[1 + i % 3],
       'FX' || i,
       (ARRAY['buy', 'sell', 'hold', 'watchlist'])[1 + i % 4],
       0.500,
       NOW() - make_interval(hours => i),
       NOW() + INTERVAL '30 days'
  FROM generate_series(1, 120) AS i;

INSERT INTO ingest.signal_dedup_keys
    (source, symbol, direction, conviction, valid_until, signal_id, claimed_at)
SELECT source, symbol, direction, conviction, valid_until, id, ingested_at
  FROM ingest.newsletter_signals
 WHERE id BETWEEN 822400001 AND 822400120;

-- analysis @025 (D-1): one single-owner strategy, one strategy_id held by two owners.
INSERT INTO analysis.strategies (user_id, strategy_id, display_name, definition_json)
VALUES ('user-a@example.test', 'fixture_unique', 'Fixture Unique', '{}'::jsonb),
       ('user-a@example.test', 'fixture_shared', 'Fixture Shared A', '{}'::jsonb),
       ('user-b@example.test', 'fixture_shared', 'Fixture Shared B', '{}'::jsonb);

-- Legacy NULL-owner runs: unique owner, ambiguous owner, no strategy; plus one already-owned run.
INSERT INTO analysis.backtest_runs (backtest_id, strategy_id, status, user_id)
VALUES ('fixture-run-unique', 'fixture_unique', 'COMPLETED', NULL),
       ('fixture-run-shared', 'fixture_shared', 'COMPLETED', NULL),
       ('fixture-run-orphan', 'fixture_gone', 'COMPLETED', NULL),
       ('fixture-run-owned', 'fixture_shared', 'COMPLETED', 'user-b@example.test');
