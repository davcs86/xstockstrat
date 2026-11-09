# Promoted from docs/roadmap/features/303-fix-agent-mcp-tools/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-303` tag.
# Durable business rules xstockstrat-agent already guarantees — a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.
#
# NOTE: source scenarios @AC-7..@AC-11 are not promoted here: each restates a guarantee already in
# agent-broker-account-tools.feature (@AC-2/@AC-3/@AC-7/@AC-8) or mcp-watchlist-tools.feature (@AC-9),
# whose Then lines were reworded type-neutrally by this feature.

Feature: xstockstrat-agent — tool errors reach the MCP caller
  Agent MCP tools raise ToolError for every anticipated refusal, so the caller sees
  "<GRPC_CODE>: <message>" instead of the SDK-masked "Error executing tool <name>"; internal
  failure details are withheld from the caller and logged on the agent.

  @AC-1 @FR-1 @FR-2 @regression @feature-303
  Scenario: A backend refusal reaches the MCP caller with its gRPC code and message
    Given the caller's verified roles are ["admin"]
    And the config backend refuses SetConfig with FAILED_PRECONDITION "ambiguous config key spelling: a and b both exist"
    When the caller invokes set_config with namespace "analysis", key "a", value_type "int", value "5", reason "r" through the MCP server dispatch
    Then the call fails with a ToolError that is not an UnexpectedToolError
    And its text is "Error executing tool set_config: FAILED_PRECONDITION: ambiguous config key spelling: a and b both exist"

  @AC-2 @FR-2 @feature-303
  Scenario: A NOT_FOUND refusal keeps the tool's literal and carries the server's hint
    Given the caller's verified roles are ["admin"]
    And the config backend refuses SetConfig with NOT_FOUND "config key not registered: foo (env=staging, user=global); pass create_key=true to register it"
    When the caller invokes set_config with namespace "analysis", key "foo", value_type "int", value "5", reason "r" through the MCP server dispatch
    Then its text is "Error executing tool set_config: NOT_FOUND: config key not found: config key not registered: foo (env=staging, user=global); pass create_key=true to register it"

  @AC-3 @FR-2 @feature-303
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

  @AC-4 @FR-4 @feature-303
  Scenario Outline: A malformed set_config value is refused without echoing it
    Given the caller's verified roles are ["admin"]
    When the caller invokes set_config with namespace "analysis", key "x", value_type "int", value "<value>", reason "r" through the MCP server dispatch
    Then the call fails with a ToolError whose text is "Error executing tool set_config: value is not a valid int"
    And the text does not contain "<value>"
    And no SetConfig RPC is sent

    Examples:
      | value                |
      | 12abc                |
      | 99999999999999999999 |

  @AC-5 @FR-2 @feature-303
  Scenario: An allow-listed UNAVAILABLE message survives a real gRPC channel verbatim
    Given analysis aborts ScoreStrategy with UNAVAILABLE "fundamentals availability unknown — grade unchanged" over a loopback gRPC channel
    When the caller invokes manage_strategy with operation "score" and strategy_id "s"
    Then the tool raises a ToolError whose text is exactly "UNAVAILABLE: fundamentals availability unknown — grade unchanged"

  @AC-6 @FR-3 @FR-1 @feature-303
  Scenario: Every listed tool surfaces a backend refusal as a ToolError
    Given each tool returned by list_tools has its first backend call refuse with FAILED_PRECONDITION "probe refusal <tool>"
    When the caller invokes each tool with valid arguments through the MCP server dispatch
    Then every call fails with a ToolError that is not an UnexpectedToolError
    And each text contains "FAILED_PRECONDITION: probe refusal <tool>"
    And the set of probed tools equals the set returned by list_tools
