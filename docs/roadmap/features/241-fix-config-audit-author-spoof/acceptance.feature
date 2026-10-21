Feature: fix-config-audit-author-spoof (bug fix)
  Regression guard for docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md:
  SetConfig audit author is caller-supplied free text, not the verified identity.

  @AC-1 @regression
  Scenario Outline: A human SetConfig write is attributed to the verified x-user-id, not the request author
    Given a caller with x-user-id "<caller>" and x-access-scope "<scope>"
    When SetConfig writes "notify.push.min_severity" = 3 in environment "staging" with user_id "<target>" and author "someone-else@example.com"
    Then the write succeeds
    And the config.config_values row's updated_by is "<caller>"
    And the newest config.config_audit row for "notify.push.min_severity" has changed_by "<caller>"
    And no config.config_audit row for that write has changed_by "someone-else@example.com"

    Examples:
      | caller      | scope | target      |
      | admin-7     | admin |             |
      | user-42     | user  | user-42     |

  @AC-2 @regression
  Scenario: An automated internal-caller write is attributed to its x-internal-caller identity
    Given a caller with no x-user-id and x-internal-caller "trading-reconciliation-poller"
    When SetConfig writes "platform.trading_state" = "REDUCE_ONLY" in environment "staging" with author "someone-else@example.com"
    Then the write succeeds
    And the newest config.config_audit row for "platform.trading_state" has changed_by "trading-reconciliation-poller"
    And its caller_identity is "trading-reconciliation-poller"
