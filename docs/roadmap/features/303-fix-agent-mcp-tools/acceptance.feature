Feature: fix-agent-mcp-tools (bug fix)
  Regression guard for the defect report 2026-11-07-agent-mcp-tool-error-details-masked-defect (pruned 2026-11-10; `git show 2d91b567:docs/reports/2026-11-07-agent-mcp-tool-error-details-masked-defect.md`):
  agent MCP tools hid every backend gRPC error message behind "Error executing tool <name>".
  Refusals are now ToolError carrying "<GRPC_CODE>: <message>"; internal failure details are
  withheld from the caller and logged on the agent.

  @AC-1 @FR-1 @FR-2 @regression
  Scenario: A backend refusal reaches the MCP caller with its gRPC code and message
    Given the caller's verified roles are ["admin"]
    And the config backend refuses SetConfig with FAILED_PRECONDITION "ambiguous config key spelling: a and b both exist"
    When the caller invokes set_config with namespace "analysis", key "a", value_type "int", value "5", reason "r" through the MCP server dispatch
    Then the call fails with a ToolError that is not an UnexpectedToolError
    And its text is "Error executing tool set_config: FAILED_PRECONDITION: ambiguous config key spelling: a and b both exist"

  @AC-2 @FR-2
  Scenario: A NOT_FOUND refusal keeps the tool's literal and carries the server's hint
    Given the caller's verified roles are ["admin"]
    And the config backend refuses SetConfig with NOT_FOUND "config key not registered: analysis.foo (env=staging, user=global); pass create_key=true to register it"
    When the caller invokes set_config with namespace "analysis", key "analysis.foo", value_type "int", value "5", reason "r" through the MCP server dispatch
    Then its text is "Error executing tool set_config: NOT_FOUND: config key not found: config key not registered: analysis.foo (env=staging, user=global); pass create_key=true to register it"

  @AC-3 @FR-2
  Scenario Outline: Internal backend failures are withheld from the caller and logged on the agent
    Given the caller's verified roles are ["admin"]
    And the <backend> backend fails <rpc> with <code> "<details>"
    When the caller invokes <tool> with <args> through the MCP server dispatch
    Then its text is "Error executing tool <tool>: <code>: <hint>"
    And the text does not contain "<details>"
    And a WARNING log from "app.tools" contains "code=<code>" and "<details>"

    Examples:
      | backend  | rpc           | code        | details                                | tool            | args                               | hint                                                          |
      | config   | GetConfig     | INTERNAL    | pq: connection refused 10.0.0.12:25060 | get_config      | namespace "analysis"               | upstream error, details withheld; report it                   |
      | analysis | ScoreStrategy | UNAVAILABLE | evidence store unavailable             | manage_strategy | operation "score", strategy_id "s" | upstream unavailable; outcome unknown, verify before retrying |

  @AC-4 @FR-4
  Scenario Outline: A malformed set_config value is refused without echoing it
    Given the caller's verified roles are ["admin"]
    When the caller invokes set_config with namespace "analysis", key "analysis.x", value_type "int", value "<value>", reason "r" through the MCP server dispatch
    Then the call fails with a ToolError whose text is "Error executing tool set_config: value is not a valid int"
    And the text does not contain "<value>"
    And no SetConfig RPC is sent

    Examples:
      | value                |
      | 12abc                |
      | 99999999999999999999 |

  @AC-5 @FR-2
  Scenario: An allow-listed UNAVAILABLE message survives a real gRPC channel verbatim
    Given analysis aborts ScoreStrategy with UNAVAILABLE "fundamentals availability unknown — grade unchanged" over a loopback gRPC channel
    When the caller invokes manage_strategy with operation "score" and strategy_id "s"
    Then the tool raises a ToolError whose text is exactly "UNAVAILABLE: fundamentals availability unknown — grade unchanged"

  @AC-6 @FR-3 @FR-1
  Scenario: Every listed tool surfaces a backend refusal as a ToolError
    Given each tool returned by list_tools has its first backend call refuse with FAILED_PRECONDITION "probe refusal <tool>"
    When the caller invokes each tool with valid arguments through the MCP server dispatch
    Then every call fails with a ToolError that is not an UnexpectedToolError
    And each text contains "FAILED_PRECONDITION: probe refusal <tool>"
    And the set of probed tools equals the set returned by list_tools

  # AC-7..AC-11 restate, type-neutrally, five durable guarantees whose Then-steps named a literal
  # exception class (C-16 CHANGE, operator sign-off in context.md). Their Then text is byte-identical
  # to the reworded durable Then so launch-time promotion classifies them as duplicates. The
  # @supersedes-* tag is informational only. AC-7/8/10/11 already hold on the current code (the
  # message text is unchanged); their red-first signal is the pytest.raises(ToolError) flip.

  @AC-7 @FR-1 @supersedes-feature-164-AC-2
  Scenario: Register rejects a missing broker type
    Given an authenticated caller with user_id "user-42"
    When they call manage_account with operation "register", display_name "My Alpaca", broker_type "", and credentials_json "{}"
    Then the tool raises an error whose text contains "broker_type ('alpaca' or 'ibkr')"
    And no RegisterBrokerAccount call is made

  @AC-8 @FR-1 @supersedes-feature-164-AC-3
  Scenario: Register rejects the offline broker type
    Given an authenticated caller with user_id "user-42"
    When they call manage_account with operation "register", display_name "Manual book", broker_type "offline", and credentials_json ""
    Then the tool raises an error whose text contains "manage_offline_account"
    And no RegisterBrokerAccount call is made

  @AC-9 @FR-1 @FR-2 @supersedes-feature-164-AC-7
  Scenario: A caller cannot act on an account they do not own
    Given an authenticated caller with user_id "user-99" who does not own account "acct-7"
    When they call manage_account with operation "deregister" and account_id "acct-7"
    And the trading backend rejects the DeregisterBrokerAccount call with PERMISSION_DENIED
    Then the tool raises an error whose text contains "PERMISSION_DENIED" and conveys the permission denial

  @AC-10 @FR-1 @supersedes-feature-164-AC-8
  Scenario: Unknown manage_account operation is rejected
    Given an authenticated caller with user_id "user-42"
    When they call manage_account with operation "delete_everything"
    Then the tool raises an error whose text lists the expected operations register/update_credentials/deregister
    And no trading backend call is made

  @AC-11 @FR-1 @supersedes-feature-148-AC-9
  Scenario: An unknown manage_watchlist_symbols operation is rejected before any RPC
    Given an authenticated caller "user-42"
    When the agent calls manage_watchlist_symbols with operation "replace"
    Then the tool raises an error whose text names the allowed operations
    And no PortfolioService RPC is called
