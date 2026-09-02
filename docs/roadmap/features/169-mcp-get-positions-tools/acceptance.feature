Feature: mcp-get-positions-tools
  As an MCP agent user, I want to query my positions — all at once or filtered
  by account — so that I can see my holdings without knowing account internals.

  @AC-1 @FR-1 @FR-3
  Scenario: get_positions returns all positions for the calling user
    Given user "user-abc" owns accounts "acct-1" (broker) and "acct-2" (offline)
    And "acct-1" holds 100 shares of AAPL and "acct-2" holds 50 shares of MSFT
    When the MCP caller with x-user-id "user-abc" invokes get_positions with no arguments
    Then the response contains {"positions": [...]} with 2 entries
    And each entry includes "symbol", "qty", "account_id", "market_value", "unrealized_pnl"

  @AC-2 @FR-2 @FR-3
  Scenario: get_positions_by_account_id returns positions for one account
    Given user "user-abc" owns account "acct-1" with 100 shares of AAPL
    When the MCP caller with x-user-id "user-abc" invokes get_positions_by_account_id with account_id "acct-1"
    Then the response contains {"positions": [...]} with 1 entry for AAPL in "acct-1"

  @AC-3 @FR-3
  Scenario: admin caller sees only their own positions, not other users'
    Given admin user "admin-1" owns account "acct-admin" with 200 shares of GOOG
    And regular user "user-xyz" owns account "acct-xyz" with 50 shares of TSLA
    When the MCP caller with x-user-id "admin-1" and admin x-access-scope invokes get_positions
    Then the response contains only the 1 position in "acct-admin"
    And no position from "acct-xyz" appears

  @AC-4 @FR-2
  Scenario: get_positions_by_account_id rejects non-owned account
    Given user "user-abc" does not own account "acct-other"
    When the MCP caller with x-user-id "user-abc" invokes get_positions_by_account_id with account_id "acct-other"
    Then the tool returns a PERMISSION_DENIED error

  @AC-5 @FR-4
  Scenario: pagination works across both tools
    Given user "user-abc" owns 25 positions across all accounts
    When the MCP caller invokes get_positions with page_size 10
    Then the response contains 10 positions and a non-empty "next_page_token"
    When the caller invokes get_positions with page_token set to the returned token
    Then the response contains the next 10 positions and another "next_page_token"

  @AC-6 @FR-5
  Scenario: response shape matches existing manage_offline_account list_positions
    Given user "user-abc" owns account "acct-1" with 100 shares of AAPL
    When the MCP caller invokes get_positions_by_account_id with account_id "acct-1"
    Then every position dict uses proto field names (snake_case) matching the output of manage_offline_account list_positions for the same account

  @AC-7 @FR-6
  Scenario: tool count inventory surfaces are consistent
    Given the new tools are registered
    Then the tools.py module docstring tool count equals the actual registered tool count
    And the agent CLAUDE.md tool table lists get_positions and get_positions_by_account_id
    And docs/runbooks/mcp-tools.md header count matches and includes per-tool sections for both

  @AC-8 @FR-7
  Scenario: descriptor-parity test prevents silent proto drift
    Given a parity test exists for get_positions and get_positions_by_account_id
    When a new field is added to the Position proto message
    Then the parity test fails until the tool's response projection is updated

  @AC-9 @FR-2
  Scenario: get_positions_by_account_id requires account_id parameter
    When the MCP caller invokes get_positions_by_account_id without an account_id
    Then the tool returns a validation error "account_id is required"

  @AC-10 @FR-1
  Scenario: get_positions returns empty list when user has no positions
    Given user "user-new" owns no accounts or positions
    When the MCP caller with x-user-id "user-new" invokes get_positions
    Then the response contains {"positions": []}
