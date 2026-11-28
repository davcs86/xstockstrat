-- Migration: 061_analysis_pipeline_keys.up.sql
-- Service: xstockstrat-config, feature pipeline-job-graph. Stored keys are namespace-relative (045 CHECK).

INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, updated_by, environment, user_id)
VALUES
  ('analysis', 'pipeline.worker_enabled', 'bool', 'true',
   'Pipeline job graph (feature 367) kill switch. When false no job is claimed, the daily prune job is not enqueued and expired leases are not reaped; jobs already running finish and write their result. Read fresh at each use.',
   'true', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'staging', NULL),
  ('analysis', 'pipeline.worker_enabled', 'bool', 'true',
   'Pipeline job graph (feature 367) kill switch. When false no job is claimed, the daily prune job is not enqueued and expired leases are not reaped; jobs already running finish and write their result. Read fresh at each use.',
   'true', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'production', NULL),
  ('analysis', 'pipeline.worker_concurrency', 'int', '4',
   'Pipeline job graph (feature 367): the number of jobs one analysis instance runs at once. Bounds [1,16]. A value of 0 or less reads as 4.',
   '4', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'staging', NULL),
  ('analysis', 'pipeline.worker_concurrency', 'int', '4',
   'Pipeline job graph (feature 367): the number of jobs one analysis instance runs at once. Bounds [1,16]. A value of 0 or less reads as 4.',
   '4', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'production', NULL),
  ('analysis', 'pipeline.poll_interval_ms', 'int', '1000',
   'Pipeline job graph (feature 367): the delay in milliseconds between claim polls while work flows; idle polling backs off to max(poll_interval_ms, 5000) ms. Bounds [200,5000]. A value of 0 or less reads as 1000.',
   '1000', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'staging', NULL),
  ('analysis', 'pipeline.poll_interval_ms', 'int', '1000',
   'Pipeline job graph (feature 367): the delay in milliseconds between claim polls while work flows; idle polling backs off to max(poll_interval_ms, 5000) ms. Bounds [200,5000]. A value of 0 or less reads as 1000.',
   '1000', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'production', NULL),
  ('analysis', 'pipeline.lease_seconds', 'int', '60',
   'Pipeline job graph (feature 367): the lease length in seconds a claimed job holds without a heartbeat; the heartbeat period is fixed at 7.5 s. Bounds [45,600]. A value of 0 or less reads as 60.',
   '60', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'staging', NULL),
  ('analysis', 'pipeline.lease_seconds', 'int', '60',
   'Pipeline job graph (feature 367): the lease length in seconds a claimed job holds without a heartbeat; the heartbeat period is fixed at 7.5 s. Bounds [45,600]. A value of 0 or less reads as 60.',
   '60', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'production', NULL),
  ('analysis', 'pipeline.max_attempts', 'int', '5',
   'Pipeline job graph (feature 367): the attempts a job may use before it ends dead. Bounds [2,20]. A value of 0 or less reads as 5.',
   '5', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'staging', NULL),
  ('analysis', 'pipeline.max_attempts', 'int', '5',
   'Pipeline job graph (feature 367): the attempts a job may use before it ends dead. Bounds [2,20]. A value of 0 or less reads as 5.',
   '5', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'production', NULL),
  ('analysis', 'pipeline.retention_days', 'int', '7',
   'Pipeline job graph (feature 367): the age in days at which succeeded jobs are pruned; failed, dead and blocked jobs are kept max(30, retention_days) days. Bounds [1,90]. A value of 0 or less reads as 7.',
   '7', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'staging', NULL),
  ('analysis', 'pipeline.retention_days', 'int', '7',
   'Pipeline job graph (feature 367): the age in days at which succeeded jobs are pruned; failed, dead and blocked jobs are kept max(30, retention_days) days. Bounds [1,90]. A value of 0 or less reads as 7.',
   '7', 'xstockstrat-analysis', 'system:config-migration-feature-pipeline-job-graph', 'production', NULL)
ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING;
