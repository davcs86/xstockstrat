Feature: fix-agent-client-deadlines (bug fix)
  Regression guard for docs/reports/2026-10-21-agent-client-deadlines-defect.md:
  agent backend gRPC calls carry no deadline, so a stalled backend hangs MCP tool calls indefinitely (debt-radar D-16;
  the get_config_value call is covered by feature 247 and excluded). Budgets: 10 s default (FR-1), 45 s for
  long-running RPCs (FR-2), every tool at least 3 s under the MCP client's 60 s request timeout (FR-3).

  @AC-1 @regression @FR-1 @FR-4
  Scenario: A stalled portfolio backend surfaces a deadline error from get_positions instead of hanging
    Given a portfolio gRPC server that accepts ListPositions but never responds
    When an authenticated MCP caller invokes get_positions
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within 10.5 seconds

  @AC-2 @regression @FR-1 @FR-4
  Scenario: A stalled config backend surfaces a deadline error from the get_config tool
    Given a config gRPC server that accepts GetConfig but never responds
    When an authenticated MCP caller invokes the get_config tool with namespace "analysis"
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within 10.5 seconds

  @AC-3 @regression @FR-1 @FR-3 @FR-4
  Scenario: A stalled ingest backend surfaces a deadline error from ingest_signal
    Given an ingest gRPC server that accepts IngestSignal but never responds
    When an authenticated MCP caller invokes ingest_signal for symbol "AAPL"
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within 10.5 seconds

  @AC-4 @regression @FR-2 @FR-4 @FR-5
  Scenario: Long-running RPCs get their own bounded budget rather than the short default
    Given an analysis gRPC server whose RunBacktest responds after 20 seconds
    When an authenticated MCP caller invokes run_backtest
    Then the tool returns the backtest result
    And a RunBacktest that never responds fails with an error derived from DEADLINE_EXCEEDED within 45.5 seconds

  @AC-5 @regression @FR-1 @FR-2 @FR-4
  Scenario Outline: Every agent backend RPC is bounded by its budget
    Given a backend gRPC server that accepts <rpc> but never responds
    When the agent client function that issues <rpc> is invoked
    Then the call fails with DEADLINE_EXCEEDED within <budget> seconds

    Examples:
      | rpc                 | budget |
      | IngestSignal        | 10.5   |
      | EmitAlert           | 10.5   |
      | ListPositions       | 10.5   |
      | GetConfig           | 10.5   |
      | RegisterOAuthClient | 10.5   |
      | RunBacktest         | 45.5   |
      | ScreenSymbols       | 45.5   |
      | RunFundamentalsScan | 45.5   |
      | TriggerBackfill     | 45.5   |

  @AC-6 @regression @FR-3
  Scenario: A tool whose backends all stall still answers before the MCP client gives up
    Given every backend the run_backtest tool calls accepts requests but never responds
    When an authenticated MCP caller invokes run_backtest
    Then the tool returns an error derived from DEADLINE_EXCEEDED within 57 seconds

  @AC-7 @regression @FR-5
  Scenario: A responsive backend returns the same result as before the fix
    Given a portfolio gRPC server that answers ListPositions with one AAPL position within 100 milliseconds
    When an authenticated MCP caller invokes get_positions
    Then the tool returns that one AAPL position
