# Promoted from docs/roadmap/features/161-surface-signal-weight-decay-config/acceptance.feature
# Source: @AC-1, @AC-2, @AC-3, @AC-9, @AC-10 — MCP agent contract scenarios
Feature: surface-signal-weight-decay-config (agent)
  Acceptance scenarios for the xstockstrat-agent service promoted from feature 161.
  Covers the list_signal_sources and manage_signal_source MCP tool contracts, and the
  SignalSource descriptor-parity contract test.

  @AC-1 @FR-1 @feature-161
  Scenario: list_signal_sources returns each source's reliability weight
    Given a signal source "sec-form4" exists with reliability_weight 0.8
    When the MCP agent calls list_signal_sources
    Then the returned entry for "sec-form4" includes reliability_weight equal to 0.8

  @AC-2 @FR-2 @feature-161
  Scenario: manage_signal_source sets the reliability weight on update
    Given a signal source "sec-form4" exists with reliability_weight 1.0
    When the MCP agent calls manage_signal_source with operation "update", slug "sec-form4", and reliability_weight 0.5
    Then the ManageSignalSource RPC is called with update_mask path "reliability_weight"
    And the tool returns reliability_weight equal to 0.5

  @AC-3 @FR-2 @feature-161
  Scenario: manage_signal_source surfaces an out-of-range weight rejection
    Given the ManageSignalSource RPC rejects reliability_weight 1.5 with INVALID_ARGUMENT
    When the MCP agent calls manage_signal_source with operation "update", slug "sec-form4", and reliability_weight 1.5
    Then the tool call fails with an error naming the invalid reliability_weight
    And no successful result is returned

  @AC-9 @FR-7 @feature-161
  Scenario: a new SignalSource proto field fails the agent parity test until surfaced
    Given the descriptor-parity contract test over the agent's SignalSource builder and projection
    When a field is present on the SignalSource proto descriptor but absent from the agent's field set and not in the intentional opt-out set
    Then the contract test fails

  @AC-10 @FR-2 @feature-161
  Scenario: updating another field alone preserves the existing reliability weight
    Given a signal source "sec-form4" exists with reliability_weight 0.7
    When the MCP agent calls manage_signal_source with operation "update", slug "sec-form4", and display_name "SEC Form 4" (no reliability_weight supplied)
    Then the ManageSignalSource RPC's update_mask does not contain "reliability_weight"
    And the source's stored reliability_weight is still 0.7
