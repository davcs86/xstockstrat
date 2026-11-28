-- Migration: 061_analysis_pipeline_keys.down.sql
-- Service: xstockstrat-config, feature pipeline-job-graph. A row an operator has changed is never deleted; the outer parentheses are load-bearing.

DELETE FROM config.config_values
WHERE namespace = 'analysis'
  AND environment IN ('staging', 'production')
  AND user_id IS NULL
  AND updated_by = 'system:config-migration-feature-pipeline-job-graph'
  AND ((key = 'pipeline.worker_enabled' AND value_data = 'true')
    OR (key = 'pipeline.worker_concurrency' AND value_data = '4')
    OR (key = 'pipeline.poll_interval_ms' AND value_data = '1000')
    OR (key = 'pipeline.lease_seconds' AND value_data = '60')
    OR (key = 'pipeline.max_attempts' AND value_data = '5')
    OR (key = 'pipeline.retention_days' AND value_data = '7'));
