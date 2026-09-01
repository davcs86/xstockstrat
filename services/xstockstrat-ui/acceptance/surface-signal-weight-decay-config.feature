# Promoted from docs/roadmap/features/161-surface-signal-weight-decay-config/acceptance.feature
# Source: @AC-4, @AC-5, @AC-6 — config-ui scenarios
Feature: surface-signal-weight-decay-config (config-ui)
  Acceptance scenarios for the xstockstrat-ui service promoted from feature 161.
  Covers the config-ui Signal Sources form, inline weight editor, and the decay half-life
  key visibility in the analysis namespace editor.

  @AC-4 @FR-3 @feature-161
  Scenario: the source create form sets reliability weight at registration time
    Given an operator opens the config-ui Signal Sources create form
    When they fill slug "insider-buys", the required source fields, and reliability_weight 0.6 and submit
    Then the created source persists reliability_weight 0.6
    And the form displays plain-language guidance text describing the weight and its 0 to 1 range

  @AC-5 @FR-4 @feature-161
  Scenario: the inline weight editor shows guidance text
    Given an operator views the config-ui Signal Sources table with source "sec-form4"
    When they open the inline weight editor for "sec-form4"
    Then plain-language guidance text describing the weight's meaning and its 0 to 1 / default 1.0 semantics is shown

  @AC-6 @FR-5 @feature-161
  Scenario: the decay half-life key is registered and visible in config-ui with bounds
    Given the config-service seed migration for analysis.scoring.signal_decay_half_life_hours has run
    When an operator opens the config-ui analysis namespace editor
    Then the key analysis.scoring.signal_decay_half_life_hours is listed with default 24.0, an operator-guidance description, and a validation of value type VALUE_TYPE_FLOAT_SCALAR with min 0 and max 8760
