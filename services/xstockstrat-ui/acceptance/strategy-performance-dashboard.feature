# Durable business-rule suite for xstockstrat-ui — promoted from launched features' acceptance.feature (C-16).
# Each scenario carries its source-feature provenance on the @feature-<NNN> tag. Additive only; never rewrite or delete a promoted scenario.

Feature: strategy-performance-dashboard
  Behavioral guarantees for the /insights performance dashboard (equity curve, drawdown, Sharpe,
  summary statistics) computed from paper-trading close events.

  @AC-1 @FR-1 @feature-031
  Scenario: Equity curve renders cumulative P&L from closed trades starting at the configured base date
    Given a trader with 10 closed paper trades recorded in the ledger
    And ui.performance.equity_curve_start_date is "2026-01-01"
    When the trader opens the insights performance dashboard
    Then the equity curve renders as a line of cumulative realized P&L over time
    And the curve's first point is dated on or after 2026-01-01
    And the final cumulative value equals the sum of the 10 trades' realized P&L

  @AC-2 @FR-2 @feature-031
  Scenario: Maximum drawdown is shown as both a dollar amount and a percentage of peak equity
    Given the cumulative P&L equity curve peaks at $5,000 and later troughs at $4,380
    When the dashboard computes maximum drawdown
    Then it displays a maximum drawdown of -$620
    And it displays a maximum drawdown of -12.4% of peak equity

  @AC-3 @FR-3 @feature-031
  Scenario: Rolling 30-day Sharpe ratio uses the configured risk-free rate
    Given ui.performance.risk_free_rate_annual is 0.045
    And a 30-day daily-returns series with non-zero standard deviation
    When the dashboard computes the rolling 30-day Sharpe ratio
    Then it equals mean(daily_returns) / std(daily_returns) x sqrt(252), net of the 0.045 annual risk-free rate
    And the displayed value is within 0.01 of the hand-computed reference calculation

  @AC-4 @FR-3 @feature-031
  Scenario: A zero-variance return window does not emit a non-finite Sharpe ratio
    Given ui.performance.risk_free_rate_annual is 0.045
    And a 30-day window where every daily return is identical (standard deviation 0)
    When the dashboard computes the rolling 30-day Sharpe ratio
    Then it does not display "Infinity" or "NaN"
    And it shows an explicit not-available placeholder instead

  @AC-5 @FR-4 @feature-031
  Scenario: Summary statistics report trade counts, win rate, and aggregates
    Given a trader with 10 closed paper trades, of which 6 are winners and 4 are losers
    When the dashboard renders its summary statistics
    Then it shows total trades 10, win count 6, and win rate 60.0%
    And it shows average return per trade, average hold time, and total realized P&L

  @AC-11 @FR-4 @feature-031
  Scenario: Average return per trade is the mean of realized P&L over cost basis from the extended close event
    Given a closed paper trade whose portfolio.position.closed event carries realized_pnl 500 and cost_basis 10000
    When the dashboard computes average return per trade
    Then it shows an average return per trade of +5.0%

  @AC-12 @FR-4 @feature-031
  Scenario: Average hold time is the mean of close time minus open time from the extended close event
    Given a closed paper trade whose portfolio.position.closed event carries opened_at "2026-02-01"
    And whose close is recorded on 2026-02-11 (the event's occurred_at)
    When the dashboard computes average hold time
    Then it shows an average hold time of 10 days

  @AC-13 @FR-4 @feature-031
  Scenario: A legacy close event without the extended fields is excluded from the per-trade averages
    Given a closed paper trade whose portfolio.position.closed event carries realized_pnl but no cost_basis or opened_at
    When the dashboard computes average return per trade and average hold time
    Then that trade is excluded from both averages
    And it is still counted in total trades, win rate, total realized P&L, and the equity curve

  @AC-6 @FR-5 @feature-031
  Scenario: Metrics auto-refresh on the default polling interval without a page reload
    Given the performance dashboard is open with the default polling interval of 60 seconds
    When a new closed paper trade is recorded in the ledger
    Then all metrics update within 65 seconds
    And the page is not reloaded

  @AC-7 @FR-6 @feature-031
  Scenario: The equity curve supports zoom and pan for a narrower window
    Given the equity curve is displayed
    When the trader zooms into and pans across a narrower time window
    Then the chart rescales to the selected window
    And the trader is not navigated away from the dashboard page

  @AC-8 @FR-7 @feature-031
  Scenario: The date range picker scopes every metric to the selected window
    Given the full equity curve spans 2026-01-01 to 2026-08-31
    When the trader selects the date range 2026-06-01 to 2026-06-30
    Then the equity curve, maximum drawdown, rolling Sharpe ratio, and summary statistics all recompute for only that window

  @AC-9 @FR-8 @feature-031
  Scenario: The "Paper Trading" label is visible when the environment-derived mode is paper
    Given the deployment environment is staging, so GetTradingEnvironment reports the trading mode paper
    When the trader opens the performance dashboard
    Then a "Paper Trading" label is visible on the dashboard

  @AC-10 @FR-8 @feature-031
  Scenario: The "Paper Trading" label is absent when the environment-derived mode is live
    Given the deployment environment is production, so GetTradingEnvironment reports the trading mode live
    When the trader opens the performance dashboard
    Then the "Paper Trading" label is not displayed
