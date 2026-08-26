# Durable business-rule suite for xstockstrat-analysis (Constitution C-16). Promoted from feature 150's
# acceptance.feature at launch; @feature-150 marks provenance. These are the guarantees a future
# feature must not regress (recon reads this suite; the design-adversary enforces it).
# Portfolio sizing mode replaces the serial per-symbol product-of-returns parlay with one shared capital
# pool, concurrent positions, and a single portfolio equity curve; legacy serial mode remains the default.

Feature: backtest-portfolio-sizing
  As a strategy analyst, I want a backtest's aggregate return to reflect a real shared-capital
  portfolio, so that total_return and max_drawdown mean what a portfolio manager expects.

  @AC-1 @FR-1 @FR-2 @feature-150
  Scenario: Portfolio mode aggregates over a shared pool, order-independent
    Given a strategy backtested in portfolio mode over 3 symbols and 100000 initial capital
    And the same run repeated with the symbol list reversed
    When each run's aggregate total_return is computed from the portfolio equity curve
    Then both runs report the same total_return within 1e-9
    And that total_return is not the serial-parlay product of the per-symbol returns

  @AC-2 @FR-1 @feature-150
  Scenario: Concurrent positions share one capital pool
    Given a portfolio-mode run where two symbols both signal entry on the same bar
    When the engine sizes those entries
    Then their combined committed capital does not exceed the shared pool
    And the per-bar portfolio equity equals cash plus the marked-to-market value of all open positions

  @AC-3 @FR-3 @feature-150
  Scenario: Legacy mode remains the default and is unchanged
    Given a backtest request that does not specify a sizing mode
    When the run executes
    Then it uses the legacy serial per-symbol model
    And its total_return byte-for-byte matches the pre-feature result for the same inputs

  @AC-4 @FR-3 @feature-150
  Scenario: The sizing mode used is recorded on the run
    Given a backtest executed in portfolio mode
    When the run is persisted to backtest_runs and returned to the caller
    Then the recorded/returned sizing mode is "portfolio"
    And a legacy run records/returns "legacy"

  @AC-5 @FR-4 @feature-150
  Scenario: The derived grade is unchanged by portfolio mode
    Given a strategy with banked per-symbol evidence cells
    When a portfolio-mode backtest is run for that strategy
    Then the per-symbol evidence cells are computed identically to legacy mode
    And the strategy's feature-065 derived headline grade is unchanged

  @AC-6 @FR-5 @feature-150
  Scenario: Insufficient capital skips an entry and is recorded as a capital skip
    Given a portfolio-mode run where the shared pool is fully committed to concurrent holdings
    When another symbol signals entry on the next bar
    Then no position is opened for that symbol on that bar
    And the run records a PortfolioCapitalSkip entry for that symbol and bar (not a zero-sized fill)
    And the total trade count is lower than an uncapped run of the same inputs

  @AC-7 @FR-6 @feature-150
  Scenario: Portfolio mode honors the strategy's own cooldown windows
    Given a strategy with a 31-day re-entry cooldown backtested in portfolio mode
    And a symbol that exits and then re-signals entry within the cooldown window
    When the engine evaluates the re-entry
    Then no re-entry position is opened inside the cooldown window
    And the cooldown is measured against the portfolio's own per-symbol exit/entry times, not analysis.strategy_cooldowns
