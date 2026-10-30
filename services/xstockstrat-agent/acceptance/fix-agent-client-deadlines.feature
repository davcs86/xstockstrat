# Promoted from docs/roadmap/features/273-fix-agent-client-deadlines/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-273` tag.
# Durable business rules xstockstrat-agent already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent - backend gRPC calls are deadline-bounded
  Agent backend gRPC calls carry a deadline so a stalled backend cannot hang MCP tool calls.
  Budgets: 10 s default (FR-1), 45 s for long-running RPCs (FR-2), every tool at least 3 s under the
  MCP client's 60 s request timeout (FR-3). Every "within N seconds" bound is asserted with an injected
  or fake clock (or a measured elapsed time with the stated tolerance), never with raw wall-clock sleeps.

  @AC-1 @regression @FR-1 @FR-4 @feature-273
  Scenario: A stalled portfolio backend surfaces a deadline error from get_positions instead of hanging
    Given a portfolio gRPC server that accepts ListPositions but never responds
    When an authenticated MCP caller invokes get_positions
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within 10.5 seconds
    And the error message says the upstream did not respond within the deadline

  @AC-2 @regression @FR-1 @FR-4 @feature-273
  Scenario: A stalled config backend surfaces a deadline error from the get_config tool
    Given a config gRPC server that accepts GetConfig but never responds
    When an authenticated MCP caller invokes the get_config tool with namespace "analysis"
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within 10.5 seconds

  @AC-3 @regression @FR-1 @FR-3 @FR-4 @feature-273
  Scenario: A stalled ingest backend surfaces a deadline error from ingest_signal
    Given an ingest gRPC server that accepts IngestSignal but never responds
    When an authenticated MCP caller invokes ingest_signal for symbol "AAPL"
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within 10.5 seconds

  @AC-4 @regression @FR-2 @FR-4 @FR-5 @feature-273
  Scenario: A long-running RPC slower than the default deadline still succeeds
    Given an analysis gRPC server whose RunBacktest responds after 20 seconds
    When an authenticated MCP caller invokes run_backtest
    Then the tool returns the backtest result

  @AC-5 @regression @FR-1 @FR-2 @FR-4 @feature-273
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

  @AC-6 @regression @FR-3 @feature-273
  Scenario: A tool whose backends all stall still answers before the MCP client gives up
    Given every backend the run_backtest tool calls accepts requests but never responds
    When an authenticated MCP caller invokes run_backtest
    Then the tool returns an error derived from DEADLINE_EXCEEDED within 57 seconds

  @AC-7 @regression @FR-5 @feature-273
  Scenario: A responsive backend returns the same result as before the fix
    Given a portfolio gRPC server that answers ListPositions with one AAPL position within 100 milliseconds
    When an authenticated MCP caller invokes get_positions
    Then the tool returns that one AAPL position

  @AC-8 @regression @FR-3 @FR-4 @feature-273
  Scenario: A tool with several sequential backend calls stays under the MCP request timeout when its follow-up calls stall
    Given an ingest gRPC server that answers IngestSignal with signal_id 42
    And a config gRPC server and a notify gRPC server that accept requests but never respond
    When an authenticated MCP caller invokes ingest_signal for symbol "AAPL" with conviction 0.9
    Then the tool returns signal_id 42 within 57 seconds

  @AC-9 @regression @FR-2 @FR-4 @feature-273
  Scenario: A long-running RPC that never responds is bounded by its own budget
    Given an analysis gRPC server that accepts RunBacktest but never responds
    When an authenticated MCP caller invokes run_backtest
    Then the tool fails with an error derived from DEADLINE_EXCEEDED within 45.5 seconds

  @AC-10 @regression @FR-1 @FR-2 @feature-273
  Scenario: No agent backend stub call is issued without a deadline
    Given the source of services/xstockstrat-agent/app/client.py
    When every unary gRPC stub call in it is enumerated statically
    Then each call passes a timeout argument, including get_config_value once feature 247 has merged ahead of this one

  @AC-11 @regression @FR-6 @feature-273
  Scenario: A stalled identity yields a bounded fail-closed 503 that keeps the session
    Given an identity gRPC server that accepts ValidateToken but never responds
    When an MCP caller sends a request with a bearer token to the agent's MCP endpoint
    Then the agent responds 503 within 10.5 seconds
    And the response carries no WWW-Authenticate header
    And the ValidateToken call carries the same x-trace-id as the rest of the request
    And a request with a genuinely invalid token still receives 401 with a WWW-Authenticate header
