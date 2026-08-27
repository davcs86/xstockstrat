Feature: surface-signal-weight-decay-config
  As a platform operator (and the MCP agent acting on their behalf), I want the per-source
  reliability weight and the signal decay half-life visible and editable through config-ui and the
  agent tools with plain-language guidance, and the dead source-weights key removed, so that I can
  tune signal ranking confidently without editing a value that has no effect.

  @AC-1 @FR-1
  Scenario: list_signal_sources returns each source's reliability weight
    Given a signal source "sec-form4" exists with reliability_weight 0.8
    When the MCP agent calls list_signal_sources
    Then the returned entry for "sec-form4" includes reliability_weight equal to 0.8

  @AC-2 @FR-2
  Scenario: manage_signal_source sets the reliability weight on update
    Given a signal source "sec-form4" exists with reliability_weight 1.0
    When the MCP agent calls manage_signal_source with operation "update", slug "sec-form4", and reliability_weight 0.5
    Then the ManageSignalSource RPC is called with update_mask path "reliability_weight"
    And the tool returns reliability_weight equal to 0.5

  @AC-3 @FR-2
  Scenario: manage_signal_source surfaces an out-of-range weight rejection
    Given the ManageSignalSource RPC rejects reliability_weight 1.5 with INVALID_ARGUMENT
    When the MCP agent calls manage_signal_source with operation "update", slug "sec-form4", and reliability_weight 1.5
    Then the tool call fails with an error naming the invalid reliability_weight
    And no successful result is returned

  @AC-10 @FR-2
  Scenario: updating another field alone preserves the existing reliability weight
    Given a signal source "sec-form4" exists with reliability_weight 0.7
    When the MCP agent calls manage_signal_source with operation "update", slug "sec-form4", and display_name "SEC Form 4" (no reliability_weight supplied)
    Then the ManageSignalSource RPC's update_mask does not contain "reliability_weight"
    And the source's stored reliability_weight is still 0.7

  @AC-4 @FR-3
  Scenario: the source create form sets reliability weight at registration time
    Given an operator opens the config-ui Signal Sources create form
    When they fill slug "insider-buys", the required source fields, and reliability_weight 0.6 and submit
    Then the created source persists reliability_weight 0.6
    And the form displays plain-language guidance text describing the weight and its 0 to 1 range

  @AC-5 @FR-4
  Scenario: the inline weight editor shows guidance text
    Given an operator views the config-ui Signal Sources table with source "sec-form4"
    When they open the inline weight editor for "sec-form4"
    Then plain-language guidance text describing the weight's meaning and its 0 to 1 / default 1.0 semantics is shown

  @AC-6 @FR-5
  Scenario: the decay half-life key is registered and visible in config-ui with bounds
    Given the config-service seed migration for analysis.scoring.signal_decay_half_life_hours has run
    When an operator opens the config-ui analysis namespace editor
    Then the key analysis.scoring.signal_decay_half_life_hours is listed with default 24.0, an operator-guidance description, and a validation of value type VALUE_TYPE_FLOAT_SCALAR with min 0 and max 8760

  @AC-7 @FR-5
  Scenario: the decay half-life is settable at the boundary without create_key
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered
    When set_config is called for that key with value 0 and a reason, without create_key
    Then the write succeeds
    And a subsequent get_config for the analysis namespace returns 0 for that key

  @AC-11 @FR-8
  Scenario: an out-of-range decay half-life write is rejected server-side without persisting
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered with bounds [0, 8760]
    When set_config is called for that key with value 9000 and a reason
    Then the write is rejected with INVALID_ARGUMENT
    And a subsequent get_config for the analysis namespace still returns 24.0 for that key

  @AC-12 @FR-8
  Scenario: a negative or non-numeric decay half-life write is rejected server-side
    Given the decay key analysis.scoring.signal_decay_half_life_hours is registered with bounds [0, 8760]
    When set_config is called for that key with value -1
    Then the write is rejected with INVALID_ARGUMENT
    And the stored value is unchanged

  @AC-8 @FR-6
  Scenario: the dead source-weights key is gone after the removal migration
    Given the config-service migration removing analysis.signals.source_weights has run
    When an operator calls list_config_keys for the analysis namespace
    Then analysis.signals.source_weights is not present in the returned keys

  @AC-9 @FR-7
  Scenario: a new SignalSource proto field fails the agent parity test until surfaced
    Given the descriptor-parity contract test over the agent's SignalSource builder and projection
    When a field is present on the SignalSource proto descriptor but absent from the agent's field set and not in the intentional opt-out set
    Then the contract test fails
