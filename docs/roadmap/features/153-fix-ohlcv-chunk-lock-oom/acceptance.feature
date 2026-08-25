Feature: fix-ohlcv-chunk-lock-oom (bug fix)
  Regression guard for defect report 2026-08-24-ohlcv-lock-table-exhaustion-recurrence-defect.md:
  TimescaleDB "out of shared memory" (SQLSTATE 53200) on 400-day ohlcv bars queries.

  @AC-1 @regression
  Scenario: A 400-day bars query over the ohlcv hypertable locks few enough chunks to succeed
    Given the marketdata.ohlcv hypertable is chunked so a 400-calendar-day window spans a small number of chunks
    And a symbol has daily bars stored across the full 400-day window
    When a caller issues GetBars for that symbol over the 400-day readiness window
    Then the query returns the bars without a Postgres "out of shared memory" (SQLSTATE 53200) error

  @AC-2 @regression
  Scenario: The ohlcv chunk-interval migration applies and reverses cleanly
    Given the marketdata migrations up to and including the new chunk-interval migration
    When the migration runner applies the up migration and then the down migration
    Then both complete without error and the ohlcv hypertable's configured chunk_time_interval matches the intended value after up and the prior value after down
