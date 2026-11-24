Feature: sso-granular-scopes
  As the platform owner who connects AI agents (Claude.ai, Claude Code, Hermes) to the xstockstrat MCP,
  I want each client to hold the least privilege it needs, read-only by default with an app-side picker to grant more,
  while my own web session keeps full access,
  so that a compromised or misbehaving agent cannot trade or change my strategies unless I allowed it.

  @AC-1 @FR-1
  Scenario: Every MCP tool maps to exactly one catalog scope
    Given the agent's registered MCP tool list
    When the agent's scope-catalog test runs
    Then every tool, including "set_strategy_live" and "list_strategies", resolves to exactly one catalog scope
    And the protected-resource metadata's "scopes_supported" equals the catalog

  @AC-2 @FR-2 @FR-3
  Scenario: An unconfigured client is refused a write tool
    Given user "david" with role "admin" in environment "production"
    And an SSO access token for "david" issued to client "xstockstrat-mcp-hermes" with every catalog scope
    And "david" has never saved a grant for "xstockstrat-mcp-hermes"
    When the client calls "set_strategy_live"
    Then the agent answers HTTP 403 with WWW-Authenticate error "insufficient_scope" naming the tool's required scope
    And no RPC reaches "xstockstrat-analysis"

  @AC-3 @FR-3
  Scenario: An unconfigured client may still read
    Given the same token and no saved grant for "xstockstrat-mcp-hermes"
    When the client calls "list_strategies"
    Then the call succeeds and returns "david"'s strategies

  @AC-4 @FR-2
  Scenario: A grant never widens the user's roles
    Given user "natalia" whose roles allow read only
    And "natalia" saved a grant giving client "xstockstrat-mcp-claude" the trading scope
    When that client calls a trading tool for "natalia"
    Then the agent answers HTTP 403 "insufficient_scope"

  @AC-5 @FR-4
  Scenario: The web session is not narrowed by client grants
    Given "david" has reset every MCP client to the read-only default
    When "david" activates a strategy from the web UI with his session cookie
    Then the activation succeeds

  @AC-6 @FR-5
  Scenario: The picker lists clients that have called, with role-limited choices
    Given "xstockstrat-mcp-hermes" called the agent for "david" in "production" at "2026-12-01T08:00:00Z"
    When "david" opens the Scope Picker in "production"
    Then he sees "xstockstrat-mcp-hermes" with last used "2026-12-01T08:00:00Z" and grant "read-only (default)"
    And scopes his roles do not allow are shown disabled

  @AC-7 @FR-5 @FR-6
  Scenario: A widened grant applies on the next call without re-authentication
    Given "david" ticks the strategies write scope for "xstockstrat-mcp-hermes" and saves
    When the same, unrefreshed token calls "manage_strategy" 61 seconds later on any agent instance
    Then the call succeeds

  @AC-8 @FR-6
  Scenario: Narrowing takes effect within the cache bound
    Given "xstockstrat-mcp-hermes" holds the strategies write scope for "david"
    When "david" presses "Reset" for that client
    And the client calls "manage_strategy" 61 seconds later
    Then the agent answers HTTP 403 "insufficient_scope"

  @AC-9 @FR-5
  Scenario: Grants are per environment
    Given "david" widened "xstockstrat-mcp-hermes" in "staging"
    When the same client calls "manage_strategy" in "production"
    Then the agent answers HTTP 403 "insufficient_scope"

  @AC-10 @FR-7
  Scenario: Legacy mode is unchanged
    Given a deployment with "auth.mode" set to "local"
    When a client authorized through the built-in OAuth server calls "manage_strategy" with "xstockstrat.write"
    Then the call succeeds exactly as before this feature
    And the Scope Picker is not shown
