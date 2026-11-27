-- Migration: 031_pipeline_job_graph.up.sql
-- Service: xstockstrat-analysis, feature pipeline-job-graph. Plain tables (no hypertable), disjoint from
-- analysis.job_schedule. Lane 10 = watchlist, 20 = held. Self-contained: tests run this file alone.

CREATE TABLE IF NOT EXISTS analysis.pipeline_jobs (
    job_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind             TEXT NOT NULL,
    subject          TEXT NOT NULL,
    epoch            TEXT NOT NULL,
    run_id           TEXT NOT NULL,
    lane             SMALLINT NOT NULL CHECK (lane IN (10, 20)),
    state            TEXT NOT NULL CHECK (state IN ('ready', 'running', 'waiting', 'succeeded', 'failed', 'dead', 'blocked')),
    attempts         INT NOT NULL DEFAULT 0,
    wait_round       SMALLINT NOT NULL DEFAULT 0,
    next_attempt_at  TIMESTAMPTZ NOT NULL,
    lease_token      UUID,
    lease_expires_at TIMESTAMPTZ,
    verdict          TEXT,
    error_class      TEXT CHECK (error_class IN ('transient', 'permanent')),
    last_error       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ,
    CHECK ((state = 'running') = (lease_token IS NOT NULL)),
    CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
    CHECK (state <> 'blocked' OR verdict IS NOT NULL),
    CHECK ((state IN ('succeeded', 'failed', 'dead', 'blocked')) = (finished_at IS NOT NULL))
) WITH (fillfactor = 70);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pipeline_jobs_kind_subject_epoch
    ON analysis.pipeline_jobs (kind, subject, epoch);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_state_lane_next_attempt_at
    ON analysis.pipeline_jobs (state, lane DESC, next_attempt_at, job_id)
    WHERE state IN ('ready', 'running', 'waiting');

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_state_finished_at
    ON analysis.pipeline_jobs (state, finished_at)
    WHERE state IN ('succeeded', 'failed', 'dead', 'blocked');

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_run_id
    ON analysis.pipeline_jobs (run_id);

CREATE TABLE IF NOT EXISTS analysis.pipeline_job_deps (
    parent_id BIGINT NOT NULL REFERENCES analysis.pipeline_jobs (job_id) ON DELETE CASCADE,
    child_id  BIGINT NOT NULL REFERENCES analysis.pipeline_jobs (job_id) ON DELETE CASCADE,
    PRIMARY KEY (parent_id, child_id),
    CHECK (parent_id <> child_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_job_deps_child_id
    ON analysis.pipeline_job_deps (child_id);
