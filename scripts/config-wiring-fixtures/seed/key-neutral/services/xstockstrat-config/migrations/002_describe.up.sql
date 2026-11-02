-- UPDATE config.config_values SET key = 'commented.out' WHERE namespace = 'analysis';
CREATE OR REPLACE FUNCTION config.fixture_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE config.config_values SET key = 'inside.function.body' WHERE namespace = 'analysis';
    RETURN NEW;
END;
$$;

CREATE TRIGGER fixture_touch
    BEFORE UPDATE ON config.config_values
    FOR EACH ROW EXECUTE FUNCTION config.fixture_touch();

UPDATE config.config_values
SET description = 'SUPERSEDED: '
                 || 'no longer read by any service.'
WHERE namespace = 'analysis' AND key = 'signals.weights';

UPDATE config.config_values
SET description = 'Weight w in [0,1]; 0 is honored.'
WHERE namespace = 'analysis'
  AND key = 'analysis.opportunity.signal_rank_weight'
  AND description = 'old';
