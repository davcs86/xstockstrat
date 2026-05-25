-- Migration: 004_agent_config.down.sql
-- Removes agent.signal.alert_threshold config key

DELETE FROM config.config_values
WHERE namespace = 'agent'
  AND key = 'signal.alert_threshold';
