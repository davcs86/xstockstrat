# Promoted from docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-198` tag.
# Durable business rules xstockstrat-marketdata already guarantees; a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata - filing-date-aware historical fundamentals store
  The historical fundamentals store holds as-reported, filing-dated periods and serves them
  point-in-time, so backtests can use fundamentals without look-ahead bias.

  @AC-1 @FR-1 @FR-2 @feature-198
  Scenario: EDGAR backfill persists point-in-time periods with filing dates
    Given AAPL's fiscal Q1-2020 income statement was filed with the SEC on 2020-01-29 with period_end 2019-12-28
    When a fundamentals backfill runs for AAPL over 2019-01-01..2020-12-31
    Then the historical fundamentals store holds an AAPL row for period_end "2019-12-28" with period_type "quarterly", source "edgar", filed_date "2020-01-29"
    And backfilling the same range again does not create a duplicate row for that (symbol, fiscal_period, period_type)

  @AC-3 @FR-5 @feature-198
  Scenario: As-of read hides a filing until the trading day after it was filed (T+1)
    Given AAPL's Q4-2019 result has period_end "2019-12-28" and filed_date "2020-01-29"
    When the point-in-time read is requested for AAPL as of "2020-01-15"
    Then the Q4-2019 period is NOT returned
    When the point-in-time read is requested for AAPL as of "2020-01-29"
    Then the Q4-2019 period is NOT returned
    When the point-in-time read is requested for AAPL as of "2020-01-30"
    Then the Q4-2019 period IS returned with its filed_date "2020-01-29"

  # NOTE: the ratio source is a guarded seam. Per marketdata CLAUDE.md, v1 wires no PIT FMP
  # ratio source, and since 217 the FMP cap is one shared budget.
  @AC-5 @FR-3 @feature-198
  Scenario: FMP-Free ratio enrichment degrades gracefully at the daily cap
    Given the FMP daily request cap for ratio enrichment is reached during a backfill
    When the backfill continues enriching remaining symbols
    Then EDGAR-sourced statement rows are still persisted for those symbols
    And the ratio fields FMP would have supplied are left null (marked source "edgar" only), not failed
