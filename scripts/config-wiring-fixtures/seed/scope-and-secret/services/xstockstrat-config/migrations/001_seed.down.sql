-- A down file is never read: neither this insert nor this unmodelled delete may count.
INSERT INTO config.config_values
  (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)
VALUES
  ('downonly', 'downonly.key', 'bool', 'true', 'down only', 'true', 'none', 'staging', NULL);
DELETE FROM config.config_values WHERE environment = 'staging';
