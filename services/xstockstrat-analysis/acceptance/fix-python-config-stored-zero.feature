# Promoted from docs/roadmap/features/244-fix-python-config-stored-zero/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-244` tag.
# Durable business rules xstockstrat-analysis guarantees for stored-zero config values.

Feature: xstockstrat-analysis - a stored zero is a value, not "unset"
  What xstockstrat-analysis guarantees when an operator stores 0 / 0.0 / "" for a config key.

  @AC-2 @FR-4 @regression @feature-244
  Scenario: A zero-cost backtest is configurable
    Given "analysis.backtest.default_commission_pct" is stored as 0.0
    And "analysis.backtest.default_slippage_pct" is stored as 0.0
    And the snapshot has no "analysis.backtest.default_fill_model" entry, so fills use the same bar's close
    And a RunBacktest whose single trade enters on a bar closing at 100.00 and exits on a bar closing at 110.00
    When RunBacktest runs
    Then the trade's entry_price is 100.00 and its exit_price is 110.00
    And the trade's pnl equals qty * 10.00, with no commission deducted

  @AC-3 @FR-4 @regression @feature-244
  Scenario: A zero signal-rank weight orders the default queue by conviction alone
    Given "analysis.opportunity.signal_rank_weight" is stored as 0.0
    And one user's live opportunities are "AAA" with conviction 0.90 and signal_axis 0.00, and "BBB" with conviction 0.50 and signal_axis 1.00
    When ListOpportunities returns the queue with the default sort
    Then "AAA" is ranked before "BBB"

  @AC-7 @FR-5 @regression @feature-244
  Scenario Outline: A stored zero whose coded default is also zero keeps its effective value
    Given "<key>" holds the <type> value <stored> (<origin>)
    When xstockstrat-analysis reads it for <site>
    Then the effective value is <effective>

    Examples:
      | key                                              | type   | stored | origin              | site                           | effective |
      | analysis.opportunity.refresh_hour_utc            | int    | 0      | seeded by 028:51,54 | the opportunity refresh hour   | 0         |
      | analysis.readiness_materializer.refresh_hour_utc | int    | 0      | seeded by 027:37,40 | the readiness re-warm hour     | 0         |
      | analysis.fundsignal.min_conviction_to_emit       | float  | 0.0    | operator-set        | the fundsignal emit floor      | 0.0       |
      | analysis.fundsignal.scoring_formula_id           | string | ""     | operator-set        | the fundsignal scoring formula | ""        |
      | analysis.fundsignal.explicit_symbols             | string | ""     | operator-set        | the explicit symbol universe   | ""        |

  @AC-9 @FR-4 @regression @feature-244
  Scenario: A zero alert throttle lets a repeat live transition alert
    Given "analysis.engine.alert_throttle_seconds" is stored as 0
    And the live loop emitted an alert for user "u1", strategy "S1" on "AAPL" 10 seconds ago
    When the next live-loop evaluation of that pair yields an ungated exit transition
    Then a second alert is emitted for user "u1", strategy "S1" on "AAPL"

  @AC-12 @FR-1 @regression @feature-244
  Scenario Outline: A key whose zero means "no limit" honours a stored zero
    Given "<key>" is stored as the int value 0
    When xstockstrat-analysis resolves it for <site>
    Then the effective value is 0, so <effect>

    Examples:
      | key                                  | site                         | effect                                  |
      | analysis.screener.default_rank_limit | the ScreenSymbols rank cap   | the result list is not truncated        |
      | analysis.patterns.min_sample_count   | the P&L-pattern sample floor | no bucket is dropped for a small sample |
