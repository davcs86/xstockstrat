-- Migration: 005_ingest_backfill_chunking.up.sql
-- Service: xstockstrat-config
-- Seeds the ingest.backfill chunking keys (feature 054) for dev + production.

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
VALUES
  ('ingest', 'backfill.chunk_max_bars', 'int', '200000',
   'Max estimated bars per backfill chunk; planner caps chunk size to this.',
   '200000', 'xstockstrat-ingest', 'dev', 'all'),
  ('ingest', 'backfill.chunk_max_bars', 'int', '200000',
   'Max estimated bars per backfill chunk; planner caps chunk size to this.',
   '200000', 'xstockstrat-ingest', 'production', 'all'),
  ('ingest', 'backfill.chunk_window_days', 'int', '90',
   'Time-window size (days) the backfill planner splits a range into before symbol batching.',
   '90', 'xstockstrat-ingest', 'dev', 'all'),
  ('ingest', 'backfill.chunk_window_days', 'int', '90',
   'Time-window size (days) the backfill planner splits a range into before symbol batching.',
   '90', 'xstockstrat-ingest', 'production', 'all'),
  ('ingest', 'backfill.max_concurrent_chunks', 'int', '3',
   'Max chunks of a single backfill job fetched in parallel.',
   '3', 'xstockstrat-ingest', 'dev', 'all'),
  ('ingest', 'backfill.max_concurrent_chunks', 'int', '3',
   'Max chunks of a single backfill job fetched in parallel.',
   '3', 'xstockstrat-ingest', 'production', 'all')
ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
