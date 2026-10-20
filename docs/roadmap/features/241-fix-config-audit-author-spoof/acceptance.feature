Feature: fix-config-audit-author-spoof (bug fix)
  Regression guard for docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md:
  SetConfig audit author is caller-supplied free text, not the verified identity.
  x-access-scope is an integer bitmap (ADMIN_SCOPE = 4, services/xstockstrat-config/src/grpc/authz.ts:8).
  The UPDATE audit trigger fires only when value_data changes (migration 017:69), so each scenario
  pins a prior value that differs from the written one.

  @AC-1 @regression
  Scenario Outline: A human SetConfig write is attributed to the verified x-user-id, not the request author
    Given a caller with x-user-id "<caller>" and x-access-scope "<scope>"
    And the "notify.push.min_severity" row in environment "staging" with user_id "<target>" holds "<prior>"
    When SetConfig writes "notify.push.min_severity" = 3 in environment "staging" with user_id "<target>" and author "someone-else@example.com"
    Then the write succeeds
    And the config.config_values row's updated_by is "<caller>"
    And the newest config.config_audit row for "notify.push.min_severity" has changed_by "<caller>"
    And no config.config_audit row for that write has changed_by "someone-else@example.com"

    Examples:
      | caller      | scope | target      | prior  |
      | admin-7     | 4     |             | 2      |
      | user-42     | 1     | user-42     | absent |

  @AC-2 @regression
  Scenario: An automated internal-caller write is attributed to its x-internal-caller identity
    Given a caller with no x-user-id and x-internal-caller "trading-reconciliation-poller"
    And the "platform.trading_state" row in environment "staging" with user_id "" holds "ACTIVE"
    When SetConfig writes "platform.trading_state" = "REDUCE_ONLY" in environment "staging" with author "someone-else@example.com"
    Then the write succeeds
    And the newest config.config_audit row for "platform.trading_state" has changed_by "trading-reconciliation-poller"
    And its caller_identity is "trading-reconciliation-poller"

  @AC-3 @regression
  Scenario Outline: A write with a free-text author but no verified identity is rejected
    Given a caller with no x-user-id, x-access-scope "4" and x-internal-caller "<internal_caller>"
    And the "notify.push.min_severity" row in environment "staging" with user_id "" holds "2"
    When SetConfig writes "notify.push.min_severity" = 3 in environment "staging" with user_id "" and author "someone-else@example.com"
    Then the write fails with INVALID_ARGUMENT
    And the "notify.push.min_severity" row in environment "staging" with user_id "" still holds "2"
    And no config.config_audit row has changed_by "someone-else@example.com"

    Examples:
      | internal_caller               |
      | absent                        |
      | trading-reconciliation-poller |
