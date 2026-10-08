# Promoted from docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-198` tag.
# Durable business rules xstockstrat-agent already guarantees; a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent - run_backtest accepts a fundamental operand
  The MCP run_backtest tool passes fundamental operands through and keeps its descriptor-parity contract.

  @AC-8 @FR-7 @feature-198
  Scenario: Agent run_backtest accepts a fundamental operand
    Given a strategy definition passed to the run_backtest MCP tool referencing operand "eps"
    When run_backtest executes over a range with backfilled fundamentals present
    Then the returned BacktestResult reflects entries gated on the point-in-time eps series
    And the run_backtest tool contract (parameters and return shape) still passes its descriptor-parity test
