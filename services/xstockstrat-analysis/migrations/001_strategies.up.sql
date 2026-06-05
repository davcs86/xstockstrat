CREATE TABLE IF NOT EXISTS analysis.strategies (
    strategy_id   TEXT PRIMARY KEY,           -- lowercase/underscore, user-supplied
    display_name  TEXT NOT NULL,
    definition_json JSONB NOT NULL,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategies_active ON analysis.strategies (active);
