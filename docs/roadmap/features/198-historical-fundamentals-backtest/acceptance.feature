Feature: historical-fundamentals-backtest
  As an operator/quant, I want a filing-date-aware historical fundamentals time series
  and a backtest that references it point-in-time, so that I can research fundamental
  strategies without look-ahead bias.

  @AC-1 @FR-1 @FR-2
  Scenario: EDGAR backfill persists point-in-time periods with filing dates
    Given AAPL's fiscal Q1-2020 income statement was filed with the SEC on 2020-01-29 with period_end 2019-12-28
    When a fundamentals backfill runs for AAPL over 2019-01-01..2020-12-31
    Then the historical fundamentals store holds an AAPL row for period_end "2019-12-28" with period_type "quarterly", source "edgar", filed_date "2020-01-29"
    And backfilling the same range again does not create a duplicate row for that (symbol, fiscal_period, period_type)

  @AC-2 @FR-1 @FR-4
  Scenario: Both quarterly and annual periods are retained as a time series
    Given AAPL has 8 quarterly and 3 annual periods filed within 2018-01-01..2020-12-31
    When a fundamentals backfill runs for AAPL over that range with period_types "both"
    Then the store returns 8 rows with period_type "quarterly" and 3 rows with period_type "annual" for AAPL
    And no earlier period row was overwritten by a later fetch

  @AC-3 @FR-5
  Scenario: As-of read hides a filing not yet public at the simulated date
    Given AAPL's Q4-2019 result has period_end "2019-12-28" and filed_date "2020-01-29"
    When the point-in-time read is requested for AAPL as of "2020-01-15"
    Then the Q4-2019 period is NOT returned
    When the point-in-time read is requested for AAPL as of "2020-02-01"
    Then the Q4-2019 period IS returned with its filed_date "2020-01-29"

  @AC-4 @FR-6
  Scenario: Backtest resolves a fundamental operand with no look-ahead bias
    Given a strategy whose entry rule is "pe_ratio < 15" using the fundamental operand
    And AAPL's period reporting pe_ratio 12 has filed_date "2020-01-29"
    When the strategy is backtested over 2020-01-01..2020-03-31
    Then no entry is evaluated using that pe_ratio on any simulated bar dated before "2020-01-29"
    And entries on bars dated "2020-01-29" or later may use pe_ratio 12

  @AC-5 @FR-3
  Scenario: FMP-Free ratio enrichment degrades gracefully at the daily cap
    Given the FMP daily request cap for ratio enrichment is reached during a backfill
    When the backfill continues enriching remaining symbols
    Then EDGAR-sourced statement rows are still persisted for those symbols
    And the ratio fields FMP would have supplied are left null (marked source "edgar" only), not failed

  @AC-6 @FR-4
  Scenario: Fundamentals backfill is a distinct data kind, not a timeframe
    Given the OHLCV backfill path is restricted to timeframe "1d"
    When a fundamentals backfill is triggered via TriggerBackfill with data_kind "FUNDAMENTALS"
    Then the job is accepted without supplying any bar timeframe
    And an existing OHLCV backfill request that omits data_kind still defaults to "BARS" and behaves unchanged

  @AC-7 @FR-7
  Scenario: Operator triggers a fundamentals backfill from the insights UI
    Given an operator on the /insights backfills page
    When they select data kind "Fundamentals", a symbol universe, and a date range and submit
    Then a fundamentals backfill job is created and its status is observable via GetBackfillStatus

  @AC-8 @FR-7
  Scenario: Agent run_backtest accepts a fundamental operand
    Given a strategy definition passed to the run_backtest MCP tool referencing operand "eps"
    When run_backtest executes over a range with backfilled fundamentals present
    Then the returned BacktestResult reflects entries gated on the point-in-time eps series
    And the run_backtest tool contract (parameters and return shape) still passes its descriptor-parity test
