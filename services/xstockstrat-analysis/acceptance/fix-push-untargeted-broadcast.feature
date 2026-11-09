# Promoted from docs/roadmap/features/242-fix-push-untargeted-broadcast/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-242` tag.

Feature: xstockstrat-analysis - live-loop alerts are targeted at the strategy owner

  @AC-4 @FR-3 @regression @feature-242
  Scenario: A live-loop strategy trigger alert is targeted at the strategy owner
    Given "user-42" owns live strategy "strat-1" that triggers "entry" on "AAPL"
    When the analysis live loop emits the strategy trigger alert
    Then notify EmitAlert receives category "strategy", severity ALERT_SEVERITY_WARNING and target_user_id "user-42"

  @AC-7 @FR-3 @regression @feature-242
  Scenario: A live-loop fundamentals-unavailable alert is targeted at the strategy owner
    Given analysis.backtest.fundamentals.enabled is true
    And "user-42" owns live strategy "strat-2" that requires fundamentals
    And "MSFT" has no usable fundamentals
    When the analysis live loop denies entry for "strat-2" on "MSFT"
    Then notify EmitAlert receives category "strategy", severity ALERT_SEVERITY_WARNING, title "Strategy strat-2: fundamentals unavailable for MSFT" and target_user_id "user-42"
