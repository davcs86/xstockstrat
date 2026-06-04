CREATE SCHEMA IF NOT EXISTS indicators;

CREATE TABLE indicators.formulas (
    formula_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    source       TEXT        NOT NULL,
    author       TEXT        NOT NULL,
    is_public    BOOLEAN     NOT NULL DEFAULT FALSE,
    input_schema JSONB       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON indicators.formulas (author);
CREATE INDEX ON indicators.formulas (is_public) WHERE is_public = TRUE;
