-- Migration: 011_opportunities.up.sql
-- Service: xstockstrat-analysis
-- Materialized per-user opportunity queue (feature 097): ListOpportunities becomes a pure read of
-- this table (LEFT JOIN opportunity_actions), refreshed by lazy compute-on-read + stale-while-
-- revalidate + a daily pass. readiness_json carries passing/total + conviction ordinal + per-leaf
-- trace inline (superseding the rejected separate readiness_cache table). Reuses the existing pool.

CREATE TABLE IF NOT EXISTS analysis.opportunities (
  user_id         TEXT             NOT NULL,
  opportunity_key TEXT             NOT NULL,
  symbol          TEXT             NOT NULL,
  strategy_id     TEXT             NOT NULL DEFAULT '',
  action          SMALLINT         NOT NULL,  -- OpportunityActionTag number (ENTER/ADD/REDUCE)
  conviction      DOUBLE PRECISION NOT NULL DEFAULT 0,
  readiness_json  JSONB            NOT NULL DEFAULT '{}'::jsonb,
  signal_axis     DOUBLE PRECISION NOT NULL DEFAULT 0,  -- normalized signal ranking axis (OR-G)
  provenance      JSONB            NOT NULL DEFAULT '[]'::jsonb,
  thesis          TEXT             NOT NULL DEFAULT '',
  valid_until     TIMESTAMPTZ      NOT NULL,
  computed_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, opportunity_key)
);

CREATE INDEX IF NOT EXISTS idx_opportunities_user_valid
  ON analysis.opportunities (user_id, valid_until);
