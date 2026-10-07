# Promoted from docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-198` tag.
# Durable business rules xstockstrat-analysis already guarantees; a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-analysis - point-in-time fundamental operand in backtests
  A strategy fundamental operand resolves from filing-dated history with T+1 availability,
  never from a current snapshot.

  @AC-4 @FR-6 @feature-198
  Scenario: Backtest resolves a fundamental operand with no look-ahead bias (T+1 availability)
    Given a strategy whose entry rule is "pe_ratio < 15" using the fundamental operand
    And AAPL's period reporting a point-in-time pe_ratio 12 has filed_date "2020-01-29"
    When the strategy is backtested over 2020-01-01..2020-03-31
    Then no entry is evaluated using that pe_ratio on any simulated bar dated on or before "2020-01-29"
    And entries on bars dated "2020-01-30" or later may use pe_ratio 12
    And the pe_ratio was computed point-in-time from the adjusted close at the filing date, not a current snapshot
