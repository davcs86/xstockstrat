Feature: fix-python-config-zero-trap (bug fix)
  Regression guard for docs/reports/2026-10-19-python-config-zero-trap-defect.md:
  Python config getters collapse a stored 0 / "" to the coded default.

  # Rows keyed "<service>.test.*" are getter-level fixture keys (the report names no indicators/ingest
  # key where 0 is legitimate); the analysis rows are the report's concrete swallowed keys.
  @AC-1 @regression
  Scenario Outline: A stored zero is honoured by the Python config getters
    Given the <service> ConfigWatcher snapshot holds "<key>" as a <type> value <stored>
    When the watcher's <getter> reads "<key>" with default <default>
    Then it returns <stored>

    Examples:
      | service                | key                                     | type   | stored | getter    | default |
      | xstockstrat-analysis   | analysis.opportunity.signal_rank_weight | float  | 0.0    | get_float | 0.3     |
      | xstockstrat-analysis   | analysis.engine.alert_throttle_seconds  | int    | 0      | get_int   | 300     |
      | xstockstrat-indicators | indicators.test.zero_int                | int    | 0      | get_int   | 7       |
      | xstockstrat-indicators | indicators.test.zero_float              | float  | 0.0    | get_float | 0.5     |
      | xstockstrat-ingest     | ingest.test.zero_int                    | int    | 0      | get_int   | 7       |
      | xstockstrat-ingest     | ingest.test.zero_string                 | string | ""     | get_str   | "x"     |

  @AC-2 @regression
  Scenario: A zero-cost backtest is configurable
    Given "analysis.backtest.default_commission_pct" is stored as 0.0
    And "analysis.backtest.default_slippage_pct" is stored as 0.0
    When RunBacktest runs without a request-level commission or slippage
    Then the backtest applies commission 0.0 and slippage 0.0

  @AC-3 @regression
  Scenario: A zero signal-rank weight removes signal rank from opportunity ranking
    Given "analysis.opportunity.signal_rank_weight" is stored as 0.0
    When ListOpportunities ranks the queue
    Then the signal-rank component contributes 0 to every opportunity's composite score

  @AC-4 @regression
  Scenario: An unset key still resolves to the coded default
    Given the analysis ConfigWatcher snapshot has no "analysis.backtest.default_commission_pct" entry
    When the watcher's get_float reads it with default 0.001
    Then it returns 0.001

  @AC-5 @regression
  Scenario: Ingest's backfill concurrency keeps its zero clamp
    Given "ingest.backfill.max_concurrent_jobs" is stored as 0
    When the ingest watcher resolves backfill_max_concurrent_jobs
    Then it returns 3
