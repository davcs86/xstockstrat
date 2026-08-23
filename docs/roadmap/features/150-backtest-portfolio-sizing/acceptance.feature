Feature: backtest-portfolio-sizing
  As a strategy analyst, I want a backtest's aggregate return to reflect a real shared-capital
  portfolio, so that total_return and max_drawdown mean what a portfolio manager expects.

  @AC-1 @FR-1 @FR-2
  Scenario: Portfolio mode aggregates over a shared pool, order-independent
    Given a strategy backtested in portfolio mode over 3 symbols and 100000 initial capital
    And the same run repeated with the symbol list reversed
    When each run's aggregate total_return is computed from the portfolio equity curve
    Then both runs report the same total_return within 1e-9
    And that total_return is not the serial-parlay product Π(1+rᵢ)−1 of the per-symbol returns

  @AC-2 @FR-1
  Scenario: Concurrent positions share one capital pool
    Given a portfolio-mode run where two symbols both signal entry on the same bar
    When the engine sizes those entries
    Then their combined committed capital does not exceed the shared pool
    And the per-bar portfolio equity equals cash plus the marked-to-market value of all open positions

  @AC-3 @FR-3
  Scenario: Legacy mode remains the default and is unchanged
    Given a backtest request that does not specify a sizing mode
    When the run executes
    Then it uses the legacy serial per-symbol model
    And its total_return byte-for-byte matches the pre-feature result for the same inputs

  @AC-4 @FR-3
  Scenario: The sizing mode used is recorded on the run
    Given a backtest executed in portfolio mode
    When the run is persisted to backtest_runs and returned to the caller
    Then the recorded/returned sizing mode is "portfolio"
    And a legacy run records/returns "legacy"

  @AC-5 @FR-4
  Scenario: The derived grade is unchanged by portfolio mode
    Given a strategy with banked per-symbol evidence cells
    When a portfolio-mode backtest is run for that strategy
    Then the per-symbol evidence cells are computed identically to legacy mode
    And the strategy's feature-065 derived headline grade is unchanged

  @AC-6 @FR-5
  Scenario: Insufficient capital skips an entry with a diagnostic reason
    Given a portfolio-mode run where the shared pool is fully committed to concurrent holdings
    When another symbol signals entry on the next bar
    Then no position is opened for that symbol on that bar
    And the bar's diagnostic records an insufficient-capital reason rather than a zero-sized fill
