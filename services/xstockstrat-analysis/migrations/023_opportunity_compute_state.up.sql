-- Migration: 023_opportunity_compute_state.up.sql
-- Service: xstockstrat-analysis
-- Per-user opportunity compute-state (feature 177, FR-3): records when a user's opportunity compute
-- last completed and until when an empty result stays fresh, so an empty-universe user does not force
-- a synchronous recompute on every poll. A dedicated table (not an in-band opportunities sentinel,
-- which the read() conviction floor filters and would re-kick every poll). Reuses the existing pool.

CREATE TABLE IF NOT EXISTS analysis.opportunity_compute_state (
    user_id     TEXT        NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id)
);
