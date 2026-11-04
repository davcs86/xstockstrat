Feature: fix-config-keys-drift (bug fix)
  Regression guard for defect report 2026-11-04-config-key-drift-and-subscription-gaps:
  config keys drift from their readers, read keys are missing from the DB, and some values never update live.

  @AC-1 @FR-1 @regression
  Scenario: A stored key never repeats its namespace
    Given the config database after all migrations
    When a row is inserted with namespace "marketdata" and key "marketdata.backfill.batch_size"
    Then the insert is rejected by the database
    And SetConfig with that namespace and key returns INVALID_ARGUMENT

  @AC-2 @FR-2 @regression
  Scenario: Every key a service reads resolves to a seeded row of the matching type
    Given the set of getter calls in every service's source
    And the set of rows seeded by the config migrations for staging and production
    When the config-parity gate runs
    Then every getter's namespace and relative key has exactly one seeded global row per environment
    And each row's value_type matches the getter's type
    And every seeded non-secret row has at least one reader

  @AC-3 @FR-3 @regression
  Scenario: Healing preserves the effective value instead of the dead row's stored intent
    Given a staging "analysis" row "fundsignal.enabled" = true that no reader consumes
    And no row "analysis.fundsignal.enabled" exists
    When the heal migration runs
    Then "analysis" / "fundsignal.enabled" exists with the reader's code default false
    And the prior row is preserved in the premigration snapshot table

  @AC-4 @FR-3 @regression
  Scenario: When both spellings exist, the row the code reads wins
    Given staging "analysis" rows "backtest.max_duration_seconds" = 300 and "analysis.backtest.max_duration_seconds" = 60
    When the heal migration runs
    Then exactly one row "analysis" / "backtest.max_duration_seconds" exists with value 60

  @AC-5 @FR-4 @regression
  Scenario: An old pod reading full-dotted keys keeps its values during the rollout
    Given the heal migration has renamed stored keys to the relative form
    And a consumer still calls its getter with "indicators.sandbox.timeout_ms"
    When it receives a WatchConfig snapshot for namespace "indicators"
    Then the getter resolves the stored value, not the code default

  @AC-6 @FR-5 @regression
  Scenario: A concurrency limit changes without a restart
    Given indicators is running with "sandbox.max_concurrent" = 4
    When an operator sets "indicators" / "sandbox.max_concurrent" to 2
    Then within one WatchConfig delivery at most 2 formulas execute concurrently
    And no in-flight execution is cancelled

  @AC-7 @FR-5 @regression
  Scenario: A marketdata vendor-client setting changes without a restart
    Given marketdata is running with "fundamentals.provider" = "finnhub"
    When an operator sets "marketdata" / "fundamentals.provider" to "fmp"
    Then the next fundamentals call is served by the fmp client
    And reads "fmp.enabled" and "fmp.cache_ttl_hours"

  @AC-8 @FR-6 @regression
  Scenario: The agent observes a config change without a per-call GetConfig
    Given the agent has subscribed to namespace "agent"
    When an operator sets "agent" / "signal.alert_threshold" to 0.9
    Then the next ingest_signal applies 0.9 without opening a new config channel

  @AC-9 @FR-7 @regression
  Scenario: Production UI renders production config
    Given production "platform.trading_state" = "HALTED" and staging = "ACTIVE"
    When a production user opens /trader/positions
    Then the halt banner for HALTED is shown

  @AC-10 @FR-8 @regression
  Scenario: A silently stalled config stream is detected and recovered
    Given a service's WatchConfig stream stops delivering without closing
    When the liveness deadline elapses
    Then the watcher abandons the stream and reconnects with backoff
    And a later config change is applied

  @AC-11 @FR-8 @regression
  Scenario: A server that closes the stream cleanly does not cause a tight reconnect loop
    Given the config server ends every WatchConfig stream immediately after the snapshot
    When the watcher runs for 10 seconds
    Then it reconnects with increasing backoff, not continuously

  @AC-12 @FR-9 @regression
  Scenario: A type-mismatched row returns the getter default, not a zero value
    Given trading "broker.timeout_ms" is stored as int 7000
    When trading reads it with the float getter and default 5000
    Then the result is 5000, or 7000 if numeric widening is the design's chosen rule, and never 0

  @AC-13 @FR-10 @regression
  Scenario: SDD review rejects a new config key without a complete contract
    Given a product spec that lists a new config key without a namespace, type, default, reader or seed migration
    When /sdd-review product-spec runs
    Then the review fails citing the config-key contract rule
