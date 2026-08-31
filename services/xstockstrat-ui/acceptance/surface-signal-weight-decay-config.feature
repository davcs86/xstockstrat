# Business-rule suite: xstockstrat-ui — surface-signal-weight-decay-config
# Promoted from docs/roadmap/features/161-surface-signal-weight-decay-config/acceptance.feature
# by /sdd-archiver on 2026-08-31 per Constitution C-16.

Feature: config-ui signal-source reliability weight display
  The config-ui Signal Sources create form and inline weight editor expose the per-source
  reliability_weight with plain-language guidance describing its meaning and valid range.

  @AC-4 @feature-161 @FR-3
  Scenario: the source create form sets reliability weight at registration time
    Given an operator opens the config-ui Signal Sources create form
    When they fill slug "insider-buys", the required source fields, and reliability_weight 0.6 and submit
    Then the created source persists reliability_weight 0.6
    And the form displays plain-language guidance text describing the weight and its 0 to 1 range

  @AC-5 @feature-161 @FR-4
  Scenario: the inline weight editor shows guidance text
    Given an operator views the config-ui Signal Sources table with source "sec-form4"
    When they open the inline weight editor for "sec-form4"
    Then plain-language guidance text describing the weight's meaning and its 0 to 1 / default 1.0 semantics is shown
