# Promoted from docs/roadmap/features/241-fix-config-audit-author-spoof/acceptance.feature
# Source: @AC-4 - agent scenario. @feature-241 marks provenance. Do not hand-author or rewrite.
Feature: fix-config-audit-author-spoof (agent)
  AC-4 asserts only the outbound request; the set_config input shape is product-spec Open Question Q2.

  @AC-4 @FR-4 @regression @feature-241
  Scenario Outline: An agent tool's SetConfig carries no free-text author and forwards the caller as x-user-id
    Given an MCP session whose verified claims carry user_id "u-1" and role "admin"
    When the agent tool "<tool>" issues its SetConfig for <write>
    Then the outbound SetConfigRequest.author is ""
    And the outbound x-user-id metadata is "u-1"

    Examples:
      | tool                 | write                                                   |
      | set_config           | the global "notify.push.min_severity" value 3           |
      | manage_signal_source | the registered source's bearer secret                   |
      | instantiate_template | the instantiated signal_source template's bearer secret |
