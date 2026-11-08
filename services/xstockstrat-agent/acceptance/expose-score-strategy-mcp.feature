# Promoted from docs/roadmap/features/283-expose-score-strategy-mcp/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-283` tag.
Feature: expose-score-strategy-mcp
  As an operator driving the platform through the MCP agent, I want to refresh a strategy's headline grade and read its evidence provenance, so that I can verify grade-affecting changes without the UI or raw gRPC.

  @AC-1 @FR-1 @feature-283
  Scenario: Refreshing an owned strategy returns the recomputed grade with provenance
    Given the caller owns strategy "fundamentals_macd_blend" with 3 eligible evidence symbols over 756 trading days
    When the caller invokes the MCP tool "manage_strategy" with operation "score" and strategy_id "fundamentals_macd_blend"
    Then the result contains rating, overall_score, component_scores, evidence_symbols 3, evidence_days 756 and provisional false, with snake_case keys

  @AC-2 @FR-1 @FR-3 @feature-283
  Scenario: Scoring a strategy the caller does not own is rejected
    Given strategy "someone_elses_strategy" is owned by another user
    When the caller invokes "manage_strategy" with operation "score" and strategy_id "someone_elses_strategy"
    Then the tool raises an error stating the strategy was not found or not owned, and no grade is written

  @AC-3 @FR-3 @feature-283
  Scenario: A strategy with no eligible evidence reports NOT_FOUND and clears the stale grade
    Given the caller owns strategy "new_strategy" with no backtest evidence cells and a stale stored grade "B"
    When the caller invokes "manage_strategy" with operation "score" and strategy_id "new_strategy"
    Then the tool raises an error containing "no eligible evidence — run a backtest" and the stored grade for "new_strategy" is absent afterwards

  @AC-4 @FR-3 @feature-283
  Scenario: Unknown fundamentals availability leaves the grade unchanged
    Given the fundamentals availability for evidence symbol "SCHD" cannot be determined because marketdata is down
    When the caller invokes "manage_strategy" with operation "score" for "fundamentals_macd_blend"
    Then the tool raises an error containing "fundamentals availability unknown — grade unchanged" and the stored grade is identical to before the call

  @AC-5 @FR-2 @feature-283
  Scenario: The tool description discloses the score side effects
    When a client lists the agent tools
    Then the "manage_strategy" description states that operation "score" persists the grade, emits an "analysis.strategy.scored" ledger event and ignores any time range

  @AC-7 @FR-5 @feature-283
  Scenario: A refresh names the excluded symbols
    Given analysis.backtest.fundamentals.enabled is on
    And strategy "fundamentals_macd_blend" has evidence cells for "AAPL", "MSFT" and "SCHD" and "SCHD" has no fundamentals
    When the caller invokes "manage_strategy" with operation "score" and strategy_id "fundamentals_macd_blend"
    Then the result shows evidence_symbols 2 and an excluded_symbols list equal to ["SCHD"]

  @AC-8 @FR-3 @feature-283
  Scenario: Every symbol excluded for missing fundamentals reports which ones
    Given analysis.backtest.fundamentals.enabled is on
    And the caller owns strategy "fundamentals_only" whose only evidence symbol "SCHD" has no fundamentals
    When the caller invokes "manage_strategy" with operation "score" and strategy_id "fundamentals_only"
    Then the tool raises an error containing "all evidence symbols excluded (fundamentals unavailable: SCHD)"

  @AC-9 @FR-1 @feature-283
  Scenario: Strategy-definition arguments are rejected for score
    When the caller invokes "manage_strategy" with operation "score", strategy_id "fundamentals_macd_blend", cooldown_days 45 and clear_fields ["exit_rule"]
    Then the tool raises an error stating that "score" accepts only strategy_id, and no backend call is made

  @AC-11 @FR-5 @feature-283
  Scenario: A refresh whose excluded list was not reported yields null, not an empty list
    Given strategy "fundamentals_macd_blend" is scored by an analysis build that sets no excluded-symbols trailer
    When the caller invokes "manage_strategy" with operation "score" and strategy_id "fundamentals_macd_blend"
    Then the result contains the recomputed rating and evidence_symbols, excluded_symbols is null rather than an empty list, and a warning is logged
