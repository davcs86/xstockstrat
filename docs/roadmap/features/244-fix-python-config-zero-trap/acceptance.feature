Feature: fix-python-config-zero-trap (bug fix)
  Regression guard for docs/reports/2026-10-19-python-config-zero-trap-defect.md:
  Python config getters collapse a stored 0 / "" to the coded default.

  # Rows keyed "<service>.test.*" are getter-level fixture keys (the report names no indicators/ingest
  # key where 0 is legitimate); the analysis rows are the report's concrete swallowed keys.
  @AC-1 @FR-1 @regression
  Scenario Outline: A stored zero is honoured by the Python config getters
    Given the <service> ConfigWatcher snapshot holds "<key>" as a <type> value <stored>
    When the watcher's <getter> reads "<key>" with default <default>
    Then it returns <stored>

    Examples:
      | service                | key                                     | type   | stored | getter    | default |
      | xstockstrat-analysis   | analysis.opportunity.signal_rank_weight | float  | 0.0    | get_float | 0.3     |
      | xstockstrat-analysis   | analysis.engine.alert_throttle_seconds  | int    | 0      | get_int   | 300     |
      | xstockstrat-analysis   | analysis.test.zero_string               | string | ""     | get_str   | "x"     |
      | xstockstrat-indicators | indicators.test.zero_int                | int    | 0      | get_int   | 7       |
      | xstockstrat-indicators | indicators.test.zero_float              | float  | 0.0    | get_float | 0.5     |
      | xstockstrat-indicators | indicators.test.zero_string             | string | ""     | get_str   | "x"     |
      | xstockstrat-ingest     | ingest.test.zero_int                    | int    | 0      | get_int   | 7       |
      | xstockstrat-ingest     | ingest.test.zero_string                 | string | ""     | get_str   | "x"     |

  @AC-2 @FR-4 @regression
  Scenario: A zero-cost backtest is configurable
    Given "analysis.backtest.default_commission_pct" is stored as 0.0
    And "analysis.backtest.default_slippage_pct" is stored as 0.0
    And the snapshot has no "analysis.backtest.default_fill_model" entry, so fills use the same bar's close
    And a RunBacktest whose single trade enters on a bar closing at 100.00 and exits on a bar closing at 110.00
    When RunBacktest runs
    Then the trade's entry_price is 100.00 and its exit_price is 110.00
    And the trade's pnl equals qty * 10.00, with no commission deducted

  # At the trapped default w=0.3, BBB (0.65) outranks AAA (0.63), so this fails on the bug.
  @AC-3 @FR-4 @regression
  Scenario: A zero signal-rank weight orders the default queue by conviction alone
    Given "analysis.opportunity.signal_rank_weight" is stored as 0.0
    And one user's live opportunities are "AAA" with conviction 0.90 and signal_axis 0.00, and "BBB" with conviction 0.50 and signal_axis 1.00
    When ListOpportunities returns the queue with the default sort
    Then "AAA" is ranked before "BBB"

  @AC-4 @FR-2 @regression
  Scenario: An unset key still resolves to the coded default
    Given the analysis ConfigWatcher snapshot has no "analysis.backtest.default_commission_pct" entry
    When the watcher's get_float reads it with default 0.001
    Then it returns 0.001

  @AC-5 @FR-3 @regression
  Scenario: Ingest's backfill concurrency keeps its zero clamp
    Given "ingest.backfill.max_concurrent_jobs" is stored as 0
    When the ingest watcher resolves backfill_max_concurrent_jobs
    Then it returns 3

  @AC-6 @FR-3 @regression
  Scenario Outline: A trap-dependent site keeps the coded default for a stored zero
    Given "<key>" is stored as a zero value
    When <service> resolves it for <site>
    Then the effective value is <effective>

    Examples:
      | service                | key                                              | site                                 | effective |
      | xstockstrat-ingest     | ingest.backfill.max_concurrent_chunks            | the backfill chunk semaphore         | 3         |
      | xstockstrat-ingest     | ingest.mcp_client.poll_interval_seconds          | the mcp_client poll loop             | 300       |
      | xstockstrat-indicators | indicators.sandbox.timeout_ms                    | ExecuteFormula                       | 5000      |
      | xstockstrat-indicators | indicators.sandbox.memory_bytes                  | ExecuteFormula                       | 134217728 |
      | xstockstrat-analysis   | analysis.screener.max_duration_seconds           | the ScreenSymbols deadline           | 120       |
      | xstockstrat-analysis   | analysis.backtest.portfolio_position_weight      | portfolio-mode sizing                | 0.10      |
      | xstockstrat-analysis   | analysis.backtest.detail_retention_per_strategy  | backtest-detail retention            | 20        |
      | xstockstrat-analysis   | analysis.opportunity.max_concurrent_bars_fetches | the opportunity bars-fetch semaphore | 2         |
      | xstockstrat-analysis   | analysis.backtest.default_fill_model             | a RunBacktest without fill_model     | 0         |

  @AC-7 @FR-5 @regression
  Scenario Outline: A seeded zero or empty row keeps its effective value
    Given the config row "<key>" holds its seeded value <seed>
    When xstockstrat-analysis reads it for <site>
    Then the effective value is <effective>

    Examples:
      | key                                        | seed | site                           | effective |
      | analysis.fundsignal.scoring_formula_id     | ""   | the fundsignal scoring formula | ""        |
      | analysis.fundsignal.min_conviction_to_emit | 0.0  | the fundsignal emit floor      | 0.0       |
      | analysis.opportunity.refresh_hour_utc      | 0    | the opportunity refresh hour   | 0         |

  @AC-8 @FR-6 @regression
  Scenario: SetConfig still rejects 0 for a minValue-1 key read by a Python service
    When SetConfig writes "analysis.opportunity.max_concurrent_bars_fetches" = 0
    Then it fails with INVALID_ARGUMENT naming the bounds [1, 5]
