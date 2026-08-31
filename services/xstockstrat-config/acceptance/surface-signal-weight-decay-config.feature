# Business-rule suite: xstockstrat-config — surface-signal-weight-decay-config
# Promoted from docs/roadmap/features/161-surface-signal-weight-decay-config/acceptance.feature
# by /sdd-archiver on 2026-08-31 per Constitution C-16.

Feature: config service decay half-life key registration and bounds enforcement
  The config service registers analysis.scoring.signal_decay_half_life_hours as a
  server-bounded FLOAT_SCALAR key with min=0, max=8760; the dead source-weights key
  is absent after its removal migration.

  @AC-6 @feature-161 @FR-5
  Scenario: the decay half-life key is registered and visible in config-ui with bounds
    Given the config-service seed migration for analysis.scoring.signal_decay_half_life_hours has run
    When an operator opens the config-ui analysis namespace editor
    Then the key analysis.scoring.signal_decay_half_life_hours is listed with default 24.0, an operator-guidance description, and a validation of value type VALUE_TYPE_FLOAT_SCALAR with min 0 and max 8760

  @AC-7 @feature-161 @FR-5
  Scenario: the decay half-life is settable at the boundary without create_key
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered
    When set_config is called for that key with value 0 and a reason, without create_key
    Then the write succeeds
    And a subsequent get_config for the analysis namespace returns 0 for that key

  @AC-8 @feature-161 @FR-6
  Scenario: the dead source-weights key is gone after the removal migration
    Given the config-service migration removing analysis.signals.source_weights has run
    When an operator calls list_config_keys for the analysis namespace
    Then analysis.signals.source_weights is not present in the returned keys

  @AC-11 @feature-161 @FR-8
  Scenario: an out-of-range decay half-life write is rejected server-side without persisting
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered with bounds [0, 8760]
    When set_config is called for that key with value 9000 and a reason
    Then the write is rejected with INVALID_ARGUMENT
    And a subsequent get_config for the analysis namespace still returns 24.0 for that key

  @AC-12 @feature-161 @FR-8
  Scenario: a negative or non-numeric decay half-life write is rejected server-side
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered with bounds [0, 8760]
    When set_config is called for that key with value -1
    Then the write is rejected with INVALID_ARGUMENT
    And the stored value is unchanged
