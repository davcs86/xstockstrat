DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND key = 'signals.source_weights';

DELETE FROM config.config_values
WHERE namespace = 'portfolio'
  AND key IN ('portfolio.snapshot.interval_minutes', 'snapshot.interval_minutes');
