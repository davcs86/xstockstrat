Feature: expose-score-strategy-mcp
  As an operator driving the platform through the MCP agent, I want to refresh a strategy's headline grade and read its evidence provenance, so that I can verify grade-affecting changes without the UI or raw gRPC.

  @AC-1 @FR-1
  Scenario: Refreshing an owned strategy returns the recomputed grade with provenance
    Given the caller owns strategy "fundamentals_macd_blend" with 3 eligible evidence symbols over 756 trading days
    When the caller invokes the MCP tool "score_strategy" with strategy_id "fundamentals_macd_blend"
    Then the result contains rating, overall_score, component_scores, evidence_symbols 3, evidence_days 756 and provisional false, with snake_case keys

  @AC-2 @FR-1 @FR-3
  Scenario: Scoring a strategy the caller does not own is rejected
    Given strategy "someone_elses_strategy" is owned by another user
    When the caller invokes "score_strategy" with strategy_id "someone_elses_strategy"
    Then the tool raises an error stating the strategy was not found or not owned, and no grade is written

  @AC-3 @FR-3
  Scenario: A strategy with no eligible evidence reports NOT_FOUND and clears the stale grade
    Given the caller owns strategy "new_strategy" with no backtest evidence cells and a stale stored grade "B"
    When the caller invokes "score_strategy" with strategy_id "new_strategy"
    Then the tool raises an error containing "no eligible evidence — run a backtest" and the stored grade for "new_strategy" is absent afterwards

  @AC-4 @FR-3
  Scenario: Unknown fundamentals availability leaves the grade unchanged
    Given the fundamentals availability for evidence symbol "SCHD" cannot be determined because marketdata is down
    When the caller invokes "score_strategy" for "fundamentals_macd_blend"
    Then the tool raises an error containing "fundamentals availability unknown — grade unchanged" and the stored grade is identical to before the call

  @AC-5 @FR-2
  Scenario: The tool description discloses the write side effects
    When a client lists the agent tools
    Then the "score_strategy" description states that it persists the grade, emits an "analysis.strategy.scored" ledger event and ignores any time range

  @AC-6 @FR-4
  Scenario: Tool-count surfaces agree
    When the six tool-count statements (tools.py, CLAUDE.md, mcp-tools.md, the /api/tools catalog and the other surfaces named by the agent parity test) are read
    Then every statement says "forty-six" and the registered tool count is 46

  @AC-7 @FR-5
  Scenario: A refresh makes the excluded symbols observable
    Given strategy "fundamentals_macd_blend" has evidence cells for "AAPL", "MSFT" and "SCHD" and "SCHD" has no fundamentals
    When the caller invokes "score_strategy" for "fundamentals_macd_blend"
    Then the result shows evidence_symbols 2 and the excluded symbols include "SCHD" (mechanism per the FR-5 design decision)
