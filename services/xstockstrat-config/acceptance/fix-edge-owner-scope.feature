# Promoted from docs/roadmap/features/263-fix-edge-owner-scope/acceptance.feature on launch
# (C-16). Scenarios are verbatim; each carries its source `@AC-*` and a `@feature-263` tag.
# Durable business rule xstockstrat-config guarantees: GetConfig/ListKeys bind a non-admin caller's per-user
# scope to the verified caller (admin may read any user). A rule enters only by promotion.
Feature: fix-edge-owner-scope (bug fix)
  Regression guard for docs/reports/2026-10-21-edge-owner-scope-defect.md:
  trader BFF ledger queryEvents and agent get_config / list_config_keys read other users' data (debt-radar D-25, D-31).

  @AC-4 @FR-3 @regression @feature-263
  Scenario: A non-admin MCP get_config with a foreign user_id is bound to the caller
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And user "u-a" has a per-user config row "analysis.backtest.max_duration_seconds" = 450 in the agent's environment scope
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls get_config with namespace "analysis" and user_id "u-b"
    Then the returned "analysis.backtest.max_duration_seconds" value is 450
    And the value 900 is not returned

  @AC-5 @FR-4 @regression @feature-263
  Scenario: A non-admin MCP list_config_keys with a foreign user_id is bound to the caller
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And user "u-a" has no per-user config rows in namespace "analysis"
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls list_config_keys with namespace "analysis" and user_id "u-b"
    Then "analysis.backtest.max_duration_seconds" is not reported as a per-user override
    And no key overridden by "u-b" is revealed

  @AC-6 @FR-5 @regression @feature-263
  Scenario: An MCP caller still reads their own per-user config overlay
    Given user "u-a" has a per-user override "analysis.backtest.max_duration_seconds" = 450
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls get_config with namespace "analysis" and user_id "u-a"
    Then the returned "analysis.backtest.max_duration_seconds" value is 450

  @AC-8 @FR-6 @regression @feature-263
  Scenario: An admin MCP caller can still read another user's per-user config overlay
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And admin user "u-admin" is the verified MCP caller
    When "u-admin" calls get_config with namespace "analysis" and user_id "u-b"
    Then the returned "analysis.backtest.max_duration_seconds" value is 900
