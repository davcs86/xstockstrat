Feature: fix-python-config-stored-zero (bug fix)
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
      | xstockstrat-ingest     | ingest.test.zero_float                  | float  | 0.0    | get_float | 0.5     |
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
  Scenario Outline: An unset or mismatched value still resolves to the coded default
    Given the <service> ConfigWatcher <state>
    When the watcher's <getter> reads "<key>" with default <default>
    Then it returns <default>

    Examples:
      | service                | state                                         | getter    | key                                      | default |
      | xstockstrat-analysis   | snapshot has no entry for the key             | get_float | analysis.backtest.default_commission_pct | 0.001   |
      | xstockstrat-analysis   | snapshot has no entry for the key             | get_int   | analysis.engine.alert_throttle_seconds   | 300     |
      | xstockstrat-analysis   | has received no snapshot                      | get_str   | analysis.test.unset_string               | "x"     |
      | xstockstrat-indicators | has received no snapshot                      | get_int   | indicators.test.unset_int                | 7       |
      | xstockstrat-indicators | snapshot holds the key as a string value "5"  | get_float | indicators.test.mismatched_float         | 0.5     |
      | xstockstrat-indicators | snapshot has no entry for the key             | get_str   | indicators.test.unset_string             | "x"     |
      | xstockstrat-ingest     | snapshot has no entry for the key             | get_str   | ingest.test.unset_string                 | "x"     |
      | xstockstrat-ingest     | snapshot holds the key as a float value 2.5   | get_int   | ingest.test.mismatched_int               | 7       |
      | xstockstrat-ingest     | snapshot has no entry for the key             | get_float | ingest.test.unset_float                  | 0.5     |

  @AC-5 @FR-3 @regression
  Scenario: Ingest's backfill job concurrency keeps its zero clamp
    Given "ingest.backfill.max_concurrent_jobs" is stored as the int value 0
    When the ingest servicer builds its backfill job semaphore
    Then the semaphore admits 3 concurrent jobs

  @AC-6 @FR-3 @regression
  Scenario Outline: A trap-dependent site keeps the coded default for a stored zero
    Given "<key>" is stored as the <type> value <stored>
    When <service> resolves it for <site>
    Then the effective value is <effective>

    Examples:
      | service                | key                                              | type   | stored | site                                  | effective                 |
      | xstockstrat-ingest     | ingest.backfill.max_concurrent_chunks            | int    | 0      | the backfill chunk semaphore capacity | 3                         |
      | xstockstrat-ingest     | ingest.backfill.chunk_max_bars                   | int    | 0      | the chunk planner's bar cap           | 200000                    |
      | xstockstrat-ingest     | ingest.backfill.chunk_window_days                | int    | 0      | the chunk planner's window in days    | 90                        |
      | xstockstrat-ingest     | ingest.mcp_client.poll_interval_seconds          | int    | 0      | the mcp_client poll loop              | 300                       |
      | xstockstrat-indicators | indicators.sandbox.timeout_ms                    | int    | 0      | ExecuteFormula                        | 5000                      |
      | xstockstrat-indicators | indicators.sandbox.memory_bytes                  | int    | 0      | ExecuteFormula                        | 134217728                 |
      | xstockstrat-indicators | indicators.sandbox.max_concurrent                | int    | 0      | the sandbox semaphore capacity        | 4                         |
      | xstockstrat-analysis   | analysis.engine.eval_interval_seconds            | int    | 0      | the live-loop sleep between cycles    | 60                        |
      | xstockstrat-analysis   | analysis.engine.max_strategies_per_cycle         | int    | 0      | the live-loop per-cycle pair budget   | 50                        |
      | xstockstrat-analysis   | analysis.engine.fundamentals_blend_strategy_id   | string | ""     | the blend-governed strategy id        | "fundamentals_macd_blend" |
      | xstockstrat-analysis   | analysis.strategy.default_cooldown_days          | int    | 0      | the default re-entry cooldown in days | 31                        |
      | xstockstrat-analysis   | analysis.scoring.shrinkage_days                  | int    | 0      | the headline-grade shrinkage k        | 250                       |
      | xstockstrat-analysis   | analysis.screener.max_duration_seconds           | int    | 0      | the ScreenSymbols deadline            | 120                       |
      | xstockstrat-analysis   | analysis.backtest.portfolio_position_weight      | float  | 0.0    | portfolio-mode sizing                 | 0.10                      |
      | xstockstrat-analysis   | analysis.backtest.detail_retention_per_strategy  | int    | 0      | backtest-detail retention             | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.max_concurrent_bars_fetches | int    | 0      | the opportunity bars-fetch semaphore  | 2                         |
      | xstockstrat-analysis   | analysis.backtest.default_fill_model             | int    | 0      | a RunBacktest without fill_model      | FILL_MODEL_SAME_BAR_CLOSE |
      | xstockstrat-analysis   | analysis.backtest.max_range_days                 | int    | 0      | the RunBacktest range cap in days     | 730                       |
      | xstockstrat-analysis   | analysis.snapshot.indicator_timeout_ms           | int    | 0      | the snapshot indicator timeout in ms  | 500                       |
      | xstockstrat-analysis   | analysis.screener.max_universe_size              | int    | 0      | the ScreenSymbols universe cap        | 100                       |
      | xstockstrat-analysis   | analysis.opportunity.max_universe_size           | int    | 0      | the opportunity universe cap          | 100                       |
      | xstockstrat-analysis   | analysis.fundsignal.run_interval_hours           | int    | 0      | the fundsignal loop interval in hours | 24                        |
      | xstockstrat-analysis   | analysis.fundsignal.daily_call_budget            | int    | 0      | the fundsignal daily call budget      | 200                       |
      | xstockstrat-ingest     | ingest.mcp_client.request_timeout_seconds        | int    | 0      | the mcp_client per-call timeout       | 30                        |
      | xstockstrat-analysis   | analysis.strategy.max_concurrent_entry_backfill  | int    | 0      | the entry-backfill semaphore          | 4                         |
      | xstockstrat-analysis   | analysis.backtest.portfolio_max_concurrent       | int    | 0      | portfolio-mode max open positions     | 9                         |
      | xstockstrat-analysis   | analysis.series.max_concurrent_components        | int    | 0      | the series component semaphore        | 4                         |
      | xstockstrat-analysis   | analysis.opportunity.max_concurrent_candidates   | int    | 0      | the opportunity candidate semaphore   | 4                         |
      | xstockstrat-analysis   | analysis.compute.max_worker_threads              | int    | 0      | the compute thread pool size          | 4                         |
      | xstockstrat-analysis   | analysis.readiness_materializer.max_concurrent_bars_fetches | int | 0 | the materializer bars semaphore | 2                         |
      | xstockstrat-analysis   | analysis.screener.max_concurrent_formula_evals   | int    | 0      | the screener formula semaphore        | 4                         |
      | xstockstrat-analysis   | analysis.fundsignal.source_slug                  | string | ""     | the fundamentals source slug          | "fundamentals"            |
      | xstockstrat-analysis   | analysis.fundsignal.max_symbols_per_run          | int    | 0      | the fundsignal per-run symbol cap     | 200                       |
      | xstockstrat-analysis   | analysis.fundsignal.valid_days                   | int    | 0      | the fundsignal signal validity days   | 90                        |
      | xstockstrat-analysis   | analysis.snapshot.signal_timeout_ms              | int    | 0      | the snapshot signal timeout in ms     | 500                       |
      | xstockstrat-analysis   | analysis.patterns.indicator_bucket_count         | int    | 0      | the P&L-pattern indicator buckets     | 5                         |
      | xstockstrat-analysis   | analysis.opportunity.max_live_strategies_per_symbol | int | 0      | the per-symbol live attribution cap   | 5                         |
      | xstockstrat-analysis   | analysis.opportunity.max_live_only_symbols_per_compute | int | 0   | the live-only symbol cap per compute  | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.max_live_held_symbols_per_compute | int | 0   | the held-symbol live cap per compute  | 20                        |
      | xstockstrat-analysis   | analysis.opportunity.valid_window_hours          | int    | 0      | the opportunity validity window hours | 24                        |
      | xstockstrat-analysis   | analysis.opportunity.snooze_default_hours        | int    | 0      | the default snooze hours              | 24                        |
      | xstockstrat-analysis   | analysis.opportunity.read_db_budget_ms           | int    | 0      | the ListOpportunities DB read budget  | 20000                     |
      | xstockstrat-analysis   | analysis.opportunity.live_enrich_timeout_ms      | int    | 0      | the live-enrich timeout in ms         | 3000                      |

  # Guards against over-clamping: a blanket max(1, ...) floor turns the seeded midnight hour into 1.
  # FR-5 audited fact: no seeded 0/'' row differs from its default; the 008 fundsignal rows are bare-keyed.
  @AC-7 @FR-5 @regression
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

  @AC-8 @FR-6 @regression
  Scenario: SetConfig still rejects 0 for a minValue-1 key read by a Python service
    Given an ADMIN caller
    And "analysis.opportunity.max_concurrent_bars_fetches" exists as an int config row (seeded by 028:87,90)
    When SetConfig writes "analysis.opportunity.max_concurrent_bars_fetches" = 0
    Then it fails with INVALID_ARGUMENT naming the bounds [1, 5]

  # Throttle check is live_loop.py:815; at the trapped default 300 s the second alert is suppressed.
  @AC-9 @FR-4 @regression
  Scenario: A zero alert throttle lets a repeat live transition alert
    Given "analysis.engine.alert_throttle_seconds" is stored as 0
    And the live loop emitted an alert for user "u1", strategy "S1" on "AAPL" 10 seconds ago
    When the next live-loop evaluation of that pair yields an ungated exit transition
    Then a second alert is emitted for user "u1", strategy "S1" on "AAPL"

  # The ConfigValue oneof carries presence; this proves ts-proto keeps a zero member on the wire.
  @AC-10 @FR-1 @regression
  Scenario Outline: An explicit zero survives the WatchConfig wire
    Given config rows hold "<key>" as the <type> value <stored>
    When a WatchConfig <update> payload is serialized and deserialized through ConfigServiceService
    Then the decoded ConfigValue for "<key>" holds its <type> member set to <stored>

    Examples:
      | key                       | type   | stored | update   |
      | analysis.test.zero_int    | int    | 0      | SNAPSHOT |
      | analysis.test.zero_float  | float  | 0.0    | SNAPSHOT |
      | analysis.test.zero_string | string | ""     | SNAPSHOT |
      | analysis.test.zero_int    | int    | 0      | DELTA    |

  @AC-11 @FR-6 @regression
  Scenario: The corrective description migration changes descriptions only and reverses cleanly
    Given the 027 and 028 seeded rows whose descriptions name the zero-trap
    When the description-only migration is applied
    Then only the description column of those rows changes, matched on their exact old text
    And no value_data, value_type or key changes and no row is inserted or deleted
    And the down migration restores each old description text exactly

  @AC-12 @FR-1 @regression
  Scenario Outline: A key whose zero means "no limit" honours a stored zero
    Given "<key>" is stored as the int value 0
    When xstockstrat-analysis resolves it for <site>
    Then the effective value is 0, so <effect>

    Examples:
      | key                                  | site                         | effect                                  |
      | analysis.screener.default_rank_limit | the ScreenSymbols rank cap   | the result list is not truncated        |
      | analysis.patterns.min_sample_count   | the P&L-pattern sample floor | no bucket is dropped for a small sample |
