# Promoted from docs/roadmap/features/161-surface-signal-weight-decay-config/acceptance.feature
# Source: @AC-7, @AC-8, @AC-11, @AC-12 — config service scenarios
Feature: surface-signal-weight-decay-config (config)
  Acceptance scenarios for the xstockstrat-config service promoted from feature 161.
  Covers the decay half-life key settability at boundary, removal of the dead source_weights key,
  and server-side bounds enforcement on out-of-range writes.

  @AC-7 @FR-5 @feature-161
  Scenario: the decay half-life is settable at the boundary without create_key
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered
    When set_config is called for that key with value 0 and a reason, without create_key
    Then the write succeeds
    And a subsequent get_config for the analysis namespace returns 0 for that key

  @AC-8 @FR-6 @feature-161
  Scenario: the dead source-weights key is gone after the removal migration
    Given the config-service migration removing analysis.signals.source_weights has run
    When an operator calls list_config_keys for the analysis namespace
    Then analysis.signals.source_weights is not present in the returned keys

  @AC-11 @FR-8 @feature-161
  Scenario: an out-of-range decay half-life write is rejected server-side without persisting
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered with bounds [0, 8760]
    When set_config is called for that key with value 9000 and a reason
    Then the write is rejected with INVALID_ARGUMENT
    And a subsequent get_config for the analysis namespace still returns 24.0 for that key

  @AC-12 @FR-8 @feature-161
  Scenario: a negative or non-numeric decay half-life write is rejected server-side
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered with bounds [0, 8760]
    When set_config is called for that key with value -1
    Then the write is rejected with INVALID_ARGUMENT
    And the stored value is unchanged
