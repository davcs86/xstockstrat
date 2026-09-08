Feature: fundamentals-blend-strategy-restrictions
  As the platform operator, I want the fundamentals blend strategy to execute
  only against the fundamentals signal universe, and to be protected from
  deactivation, live-toggle-off, and deletion — ensuring it remains always-on,
  always-live, and exclusively scoped to its intended fundamentals universe.

  @AC-1 @FR-1
  Scenario: Blend strategy is skipped when fundamentals_blend_enabled is false
    Given a strategy with strategy_id "fundamentals_macd_blend" is registered and active
    And config key "analysis.engine.fundamentals_blend_strategy_id" is "fundamentals_macd_blend"
    And config key "analysis.engine.fundamentals_blend_enabled" is false
    When the live loop runs _run_cycle
    Then the strategy "fundamentals_macd_blend" is not evaluated at all
    And no universe resolution occurs for "fundamentals_macd_blend"

  @AC-2 @FR-1
  Scenario: Blend strategy is skipped when fundamentals universe is empty
    Given a strategy with strategy_id "fundamentals_macd_blend" is registered and active
    And config key "analysis.engine.fundamentals_blend_enabled" is true
    And the fundamentals universe resolution returns an empty set
    When the live loop runs _run_cycle
    Then the strategy "fundamentals_macd_blend" is not evaluated at all

  @AC-3 @FR-1
  Scenario: Blend strategy evaluates only against fundamentals universe when active
    Given a strategy with strategy_id "fundamentals_macd_blend" is registered and active
    And config key "analysis.engine.fundamentals_blend_enabled" is true
    And the fundamentals universe resolves to ["AAPL", "MSFT", "GOOG"]
    When the live loop runs _run_cycle
    Then the strategy "fundamentals_macd_blend" is evaluated with universe {"AAPL", "MSFT", "GOOG"}
    And the strategy does not use resolve_universe fallback

  @AC-4 @FR-2
  Scenario: ManageStrategy DEACTIVATE is rejected for the blend strategy
    Given a strategy with strategy_id "fundamentals_macd_blend" is registered and active
    And config key "analysis.engine.fundamentals_blend_strategy_id" is "fundamentals_macd_blend"
    When ManageStrategy is called with operation DEACTIVATE and strategy_id "fundamentals_macd_blend"
    Then the RPC returns gRPC status FAILED_PRECONDITION
    And the error message contains "fundamentals blend strategy cannot be deactivated"
    And the strategy remains active in the database

  @AC-5 @FR-2
  Scenario: ManageStrategy DEACTIVATE succeeds for non-blend strategies
    Given a strategy with strategy_id "my_custom_strategy" is registered and active
    And config key "analysis.engine.fundamentals_blend_strategy_id" is "fundamentals_macd_blend"
    When ManageStrategy is called with operation DEACTIVATE and strategy_id "my_custom_strategy"
    Then the RPC succeeds
    And the strategy "my_custom_strategy" is deactivated

  @AC-6 @FR-3
  Scenario: SetStrategyLive rejects live_enabled=false for the blend strategy
    Given a strategy with strategy_id "fundamentals_macd_blend" is registered and live
    And config key "analysis.engine.fundamentals_blend_strategy_id" is "fundamentals_macd_blend"
    When SetStrategyLive is called with strategy_id "fundamentals_macd_blend" and live_enabled false
    Then the RPC returns gRPC status FAILED_PRECONDITION
    And the error message contains "fundamentals blend strategy cannot be set non-live"
    And the strategy remains live_enabled in the database

  @AC-7 @FR-3
  Scenario: SetStrategyLive succeeds for non-blend strategies
    Given a strategy with strategy_id "my_custom_strategy" is registered and live
    And config key "analysis.engine.fundamentals_blend_strategy_id" is "fundamentals_macd_blend"
    When SetStrategyLive is called with strategy_id "my_custom_strategy" and live_enabled false
    Then the RPC succeeds
    And the strategy "my_custom_strategy" has live_enabled false

  @AC-8 @FR-4
  Scenario: Protection tracks runtime config value, not a hardcoded ID
    Given a strategy with strategy_id "custom_blend_v2" is registered and active
    And config key "analysis.engine.fundamentals_blend_strategy_id" is "custom_blend_v2"
    When ManageStrategy is called with operation DEACTIVATE and strategy_id "custom_blend_v2"
    Then the RPC returns gRPC status FAILED_PRECONDITION
    And the error message contains "fundamentals blend strategy cannot be deactivated"
