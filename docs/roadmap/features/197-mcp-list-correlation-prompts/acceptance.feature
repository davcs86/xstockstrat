Feature: mcp-list-correlation-prompts
  As an AI agent operating the xstockstrat MCP, I want the list/read tools to document how their
  responses correlate — and a dedicated correlation-guide prompt I can fetch — so that I can join
  accounts, positions, opportunities, and strategies on the correct keys without guessing.

  @AC-1 @FR-1
  Scenario: get_positions docstring names the account_id and symbol joins
    Given the xstockstrat-agent MCP server is running
    When a client fetches the tool descriptor for "get_positions"
    Then the description states that positions join to list_accounts on "account_id" equal to the account's "id"
    And it states that positions join to list_opportunities on "symbol"
    And it states that a position carries no "strategy_id"

  @AC-2 @FR-1
  Scenario: list_accounts docstring names its key as the parent of the position join
    Given the xstockstrat-agent MCP server is running
    When a client fetches the tool descriptor for "list_accounts"
    Then the description states that each account's "id" matches "account_id" on get_positions rows
    And it states that get_positions_by_account_id takes that same "id" as its account_id argument

  @AC-3 @FR-1
  Scenario: list_opportunities and list_strategies docstrings name the strategy_id join
    Given the xstockstrat-agent MCP server is running
    When a client fetches the tool descriptors for "list_opportunities" and "list_strategies"
    Then the list_opportunities description states that each opportunity's "strategy_id" matches a "strategy_id" from list_strategies
    And the list_strategies description states that a strategy's "strategy_id" is referenced by list_opportunities rows but never by a position

  @AC-4 @FR-2
  Scenario: prompts/list advertises the correlation-guide prompt
    Given the xstockstrat-agent MCP server is running with an OAuth-gated session
    When the client sends a "prompts/list" request
    Then the response contains a prompt whose name identifies the list-correlation guide (e.g. "correlate_list_responses")
    And that prompt entry carries a non-empty human-readable description

  @AC-5 @FR-3
  Scenario: prompts/get returns the three join keys and the non-joins
    Given the xstockstrat-agent MCP server is running with an OAuth-gated session
    When the client sends a "prompts/get" request for the list-correlation guide prompt
    Then the returned message content names the account_id join ("list_accounts.id" to "get_positions.account_id")
    And it names the strategy_id join ("list_strategies.strategy_id" to "list_opportunities.strategy_id")
    And it names the symbol join ("get_positions.symbol" to "list_opportunities.symbol")
    And it states that positions carry no strategy_id and opportunities/strategies carry no account_id

  @AC-6 @FR-4
  Scenario: the runbook's correlation section matches the tool docstrings
    Given docs/runbooks/mcp-tools.md has a "Correlating list responses" section
    When the join keys in that section are compared to the enriched tool docstrings and the prompt content
    Then all three surfaces name the same three join keys and the same two non-joins with no contradiction

  @AC-7 @FR-5
  Scenario: the correlation prompt leaks no user data or secrets
    Given the list-correlation guide prompt content
    When it is inspected
    Then it contains only static join-key guidance and example field names
    And it contains no account ids, position rows, strategy definitions, or secret values

  @AC-8 @FR-6
  Scenario: a parity test fails if the prompt or a docstring drops a join key
    Given the agent test suite pins the correlation guidance
    When the correlation prompt content or an enriched docstring omits one of the three join keys ("account_id", "strategy_id", "symbol")
    Then the parity test fails, preventing the doc from silently drifting from the tools it describes
