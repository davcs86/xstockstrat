-- Not in the closed model: no literal namespace/key guard.
DELETE FROM config.config_values WHERE environment = 'staging';
