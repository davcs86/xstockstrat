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

  @AC-3 @FR-1 @FR-5 @regression
  Scenario: A trader still reads their own account and copilot streams
    Given user "u-a" is signed in to /trader
    And the ledger holds a "reconciliation.tick" event on stream "account:acct-a"
    When "u-a" calls trader BFF LedgerService.QueryEvents with stream_key "account:acct-a"
    Then the "reconciliation.tick" event on "account:acct-a" is returned
    And a QueryEvents with stream_key "copilot:anything" returns only the "u-a" copilot thread

  @AC-4 @FR-3 @regression
  Scenario: A non-admin MCP caller cannot read another user's per-user config overrides
    Given user "u-b" has a per-user override "analysis.backtest.max_duration_seconds" = 900 in the agent's environment
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls get_config with namespace "analysis" and user_id "u-b"
    Then the tool fails with a permission error
    And the value 900 is not returned

  @AC-5 @FR-4 @regression
  Scenario: A non-admin MCP caller cannot list another user's overridden config keys
    Given user "u-b" has a per-user override "analysis.backtest.max_duration_seconds" = 900
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls list_config_keys with namespace "analysis" and user_id "u-b"
    Then the tool fails with a permission error

  @AC-6 @FR-5 @regression
  Scenario: An MCP caller still reads their own per-user config overlay
    Given user "u-a" has a per-user override "analysis.backtest.max_duration_seconds" = 450
    And non-admin user "u-a" is the verified MCP caller
    When "u-a" calls get_config with namespace "analysis" and user_id "u-a"
    Then the returned "analysis.backtest.max_duration_seconds" value is 450
