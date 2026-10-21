Feature: fix-edge-owner-scope (bug fix)
  Regression guard for docs/reports/2026-10-21-edge-owner-scope-defect.md:
  trader BFF ledger queryEvents and agent get_config / list_config_keys read other users' data (debt-radar D-25, D-31).

  Background:
    Given user "u-a" owns broker account "acct-a" and user "u-b" owns broker account "acct-b"
    And the ledger holds an "order.filled" event on stream "account:acct-b" for user "u-b" symbol "AAPL"

  @AC-1 @FR-1 @regression
  Scenario: A trader cannot read another user's account stream through the trader BFF
    Given user "u-a" is signed in to /trader
    When "u-a" calls trader BFF LedgerService.QueryEvents with stream_key "account:acct-b"
    Then the call fails with PERMISSION_DENIED
    And no event from stream "account:acct-b" is returned

  @AC-2 @FR-2 @regression
  Scenario: A trader BFF query with no stream key returns no other user's events
    Given user "u-a" is signed in to /trader
    When "u-a" calls trader BFF LedgerService.QueryEvents with event_type "order.filled" and no stream_key
    Then the response contains no event belonging to user "u-b"
    And the response contains no event whose user_id is NULL

  @AC-3 @FR-1 @FR-5 @regression
  Scenario: A trader still reads their own account and copilot streams
    Given user "u-a" is signed in to /trader
    And the ledger holds a "reconciliation.tick" event on stream "account:acct-a"
    When "u-a" calls trader BFF LedgerService.QueryEvents with stream_key "account:acct-a"
    Then the "reconciliation.tick" event on "account:acct-a" is returned
    And a QueryEvents with stream_key "copilot:anything" returns only the "u-a" copilot thread

  @AC-4 @FR-3 @regression
  Scenario: A non-admin MCP caller cannot read another user's per-user config overrides
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls get_config with namespace "analysis" and user_id "u-b"
    Then the tool fails with PERMISSION_DENIED
    And the value 900 is not returned

  @AC-5 @FR-4 @regression
  Scenario: A non-admin MCP caller cannot list another user's overridden config keys
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls list_config_keys with namespace "analysis" and user_id "u-b"
    Then the tool fails with PERMISSION_DENIED
    And no key overridden by "u-b" is revealed

  @AC-6 @FR-5 @regression
  Scenario: An MCP caller still reads their own per-user config overlay
    Given user "u-a" has a per-user override "analysis.backtest.max_duration_seconds" = 450
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls get_config with namespace "analysis" and user_id "u-a"
    Then the returned "analysis.backtest.max_duration_seconds" value is 450

  @AC-7 @FR-2 @FR-5 @regression
  Scenario: A trader still reads their own position lineage with no stream key
    Given user "u-a" is signed in to /trader
    And the ledger holds an "order.filled" event on stream "account:acct-a" for user "u-a" symbol "MSFT"
    When "u-a" calls trader BFF LedgerService.QueryEvents with event_type "order.filled" and no stream_key
    Then the "order.filled" event for user "u-a" symbol "MSFT" is returned

  @AC-8 @FR-6 @regression
  Scenario: An admin MCP caller can still read another user's per-user config overlay
    Given user "u-b" has a per-user config row "analysis.backtest.max_duration_seconds" = 900 in the agent's environment scope
    And admin user "u-admin" is the verified MCP caller
    When "u-admin" calls get_config with namespace "analysis" and user_id "u-b"
    Then the returned "analysis.backtest.max_duration_seconds" value is 900
