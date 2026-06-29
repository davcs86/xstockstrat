-- Migration: 002_fundamentals.up.sql
-- Service: xstockstrat-marketdata
-- Creates the read-through FMP fundamentals cache (feature 059). Plain table
-- (latest-snapshot semantics, not a hypertable). The fetched_at index backs the
-- UTC-day quota count (FR-4).

CREATE TABLE IF NOT EXISTS marketdata.fundamentals (
  symbol          text PRIMARY KEY,
  as_of           timestamptz NOT NULL,
  market_cap      numeric,
  pe_ratio        numeric,
  pb_ratio        numeric,
  dividend_yield  numeric,
  eps             numeric,
  beta            numeric,
  roe             numeric,
  debt_to_equity  numeric,
  price           numeric,
  year_high       numeric,
  year_low        numeric,
  extra_metrics   jsonb NOT NULL DEFAULT '{}',
  currency        text,
  source          text NOT NULL DEFAULT 'fmp',
  fetched_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fundamentals_fetched_at
  ON marketdata.fundamentals (fetched_at);
