CREATE TABLE IF NOT EXISTS analysis.strategy_scores (
    strategy_id      TEXT PRIMARY KEY,
    overall_score    DOUBLE PRECISION NOT NULL,
    rating           TEXT NOT NULL,
    component_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
