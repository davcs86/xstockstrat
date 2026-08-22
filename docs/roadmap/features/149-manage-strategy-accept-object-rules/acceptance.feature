Feature: manage-strategy-accept-object-rules
  As an operator driving the platform through an MCP client that pre-parses JSON arguments,
  I want manage_strategy to accept a rule passed as a JSON object (not only a JSON string),
  so that I can register and update strategies regardless of how my client encodes JSON arguments.

  @AC-1 @FR-1
  Scenario: A rule supplied as a JSON object is accepted and stored as a JSON string
    Given a manage_strategy(operation='register') call for strategy_id "obj_rule_demo"
    And entry_rule supplied as the object {"op": "AND", "conditions": [{"fn": ">", "lhs": "mq", "rhs": 0.3}]}
    When the tool builds the outbound definition
    Then entry_rule in the definition is the JSON string "{\"op\": \"AND\", \"conditions\": [{\"fn\": \">\", \"lhs\": \"mq\", \"rhs\": 0.3}]}"
    And the call is not rejected for an invalid argument type

  @AC-2 @FR-3
  Scenario: A rule supplied as a JSON string passes through unchanged
    Given a manage_strategy(operation='register') call for strategy_id "str_rule_demo"
    And exit_rule supplied as the string "{\"fn\": \"crosses_below\", \"lhs\": \"vts\", \"rhs\": 0}"
    When the tool builds the outbound definition
    Then exit_rule in the definition is byte-for-byte the same string "{\"fn\": \"crosses_below\", \"lhs\": \"vts\", \"rhs\": 0}"

  @AC-3 @FR-2
  Scenario: An omitted rule is left out of the definition and update mask
    Given a manage_strategy(operation='update') call for strategy_id "partial_demo"
    And only cooldown_days is supplied as 45
    And entry_rule and exit_rule are omitted
    When the tool builds the outbound definition and update mask
    Then the definition contains "cooldown_days" but neither "entry_rule" nor "exit_rule"
    And the update mask is exactly ["cooldown_days"]

  @AC-4 @FR-1
  Scenario: Both rules as objects on the same call are each serialized
    Given a manage_strategy(operation='register') call for strategy_id "both_obj_demo"
    And entry_rule supplied as the object {"fn": "<", "lhs": "rsi", "rhs": 35}
    And exit_rule supplied as the object {"fn": "crosses_below", "lhs": "vts", "rhs": 0}
    When the tool builds the outbound definition
    Then entry_rule and exit_rule in the definition are both JSON strings that round-trip via json.loads back to the supplied objects

  @AC-5 @FR-4
  Scenario: Every documentation surface reflects the widened input type
    Given the manage_strategy change has been applied
    When the manage_strategy docstring, docs/runbooks/mcp-tools.md, and the strat-lab backtest skill are read
    Then each states that entry_rule/exit_rule accept a JSON string or a JSON object (dict)

  @AC-6 @FR-1
  Scenario: An empty JSON object is serialized to "{}" and enters the update mask
    Given a manage_strategy(operation='update') call for strategy_id "empty_obj_demo"
    And entry_rule supplied as the empty object {}
    When the tool builds the outbound definition and update mask
    Then entry_rule in the definition is the JSON string "{}"
    And the update mask contains "entry_rule"
