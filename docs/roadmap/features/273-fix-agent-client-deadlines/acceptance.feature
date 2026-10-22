Feature: fix-agent-client-deadlines (bug fix)
  Regression guard for docs/reports/2026-10-21-agent-client-deadlines-defect.md:
  agent backend gRPC calls carry no deadline, so a stalled backend hangs MCP tool calls indefinitely (debt-radar D-16;
  the get_config_value call is covered by feature 247 and excluded).

  @AC-1 @regression
  Scenario: A stalled portfolio backend surfaces a deadline error from get_positions instead of hanging
    Given a portfolio gRPC server that accepts ListPositions but never responds
    When an authenticated MCP caller invokes get_positions
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within the agent's default deadline plus 0.5 seconds

  @AC-2 @regression
  Scenario: A stalled config backend surfaces a deadline error from the get_config tool
    Given a config gRPC server that accepts GetConfig but never responds
    When an authenticated MCP caller invokes get_config with namespace "analysis"
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within the agent's default deadline plus 0.5 seconds

  @AC-3 @regression
  Scenario: A stalled ingest backend surfaces a deadline error from ingest_signal
    Given an ingest gRPC server that accepts IngestSignal but never responds
    When an authenticated MCP caller invokes ingest_signal for symbol "AAPL"
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within the agent's default deadline plus 0.5 seconds

  @AC-4 @regression
  Scenario: Long-running RPCs get their own bounded budget rather than the short default
    Given an analysis gRPC server whose RunBacktest takes longer than the default deadline but less than the backtest budget
    When an authenticated MCP caller invokes run_backtest
    Then the tool returns the backtest result
    And a RunBacktest that never responds fails with an error derived from DEADLINE_EXCEEDED within the backtest budget plus 0.5 seconds

  @AC-5 @regression
  Scenario: Every unary backend call in the agent client carries a deadline
    Given the agent client module services/xstockstrat-agent/app/client.py
    When each client function is invoked against a mocked stub
    Then every stub call receives a positive timeout argument
