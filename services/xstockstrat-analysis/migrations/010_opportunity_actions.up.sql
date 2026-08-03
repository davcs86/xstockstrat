-- Migration: 010_opportunity_actions.up.sql
-- Service: xstockstrat-analysis
-- Persisted per-user disposition (snooze/dismiss/take) of a queued opportunity (feature 097),
-- keyed by the server-authoritative opportunity_key. Reuses the existing asyncpg pool (no new pool).

CREATE TABLE IF NOT EXISTS analysis.opportunity_actions (
  user_id         TEXT        NOT NULL,
  opportunity_key TEXT        NOT NULL,
  action          SMALLINT    NOT NULL,  -- OpportunityAction enum number (SNOOZE/DISMISS/TAKE)
  snooze_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, opportunity_key)
);
