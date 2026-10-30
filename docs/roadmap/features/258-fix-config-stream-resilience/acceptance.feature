Feature: fix-config-stream-resilience (bug fix)
  Regression guard for docs/reports/2026-10-21-config-stream-resilience-defect.md:
  config change propagation and config/ledger handlers fail silently on DB errors (debt-radar D-05, D-06, D-35, D-58).

  @AC-1 @FR-1 @regression
  Scenario: Config change propagation resumes after the LISTEN connection drops
    Given xstockstrat-config is running with a WatchConfig subscriber on namespace "analysis" environment "staging"
    And the config LISTEN connection to Postgres is terminated
    When a SetConfig writes global key "analysis.backtest.max_duration_seconds" = 600 in "staging"
    Then the subscriber receives a DELTA carrying "analysis.backtest.max_duration_seconds" = 600
    And the config process was not restarted

  @AC-2 @FR-2 @regression
  Scenario: A failing reload inside the notification handler does not crash config
    Given the config LISTEN client receives a "config_changed" notification for namespace "analysis"
    And the reload query for that namespace rejects with "connection terminated"
    When the notification is handled
    Then a log record at error level containing "connection terminated" is captured
    And no unhandled promise rejection is raised and the process keeps serving GetConfig

  @AC-3 @FR-3 @regression
  Scenario: GetConfig returns an error status when the per-user overlay query fails
    Given the per-user overlay query for namespace "analysis" user "u-1" rejects with "connection terminated"
    When GetConfig is called with namespace "analysis" and user_id "u-1"
    Then the callback is invoked with a gRPC error status
    And no unhandled promise rejection is raised

  @AC-4 @FR-3 @regression
  Scenario: SetConfig returns an error status when the existence-gate query fails
    Given the existence-gate query for namespace "analysis" key "analysis.backtest.max_duration_seconds" rejects with "connection terminated"
    When an admin calls SetConfig for that key with value 600
    Then the callback is invoked with a gRPC error status
    And no unhandled promise rejection is raised

  @AC-5 @FR-3 @regression
  Scenario: Idempotent AppendEvent returns an error status when no pool connection can be acquired
    Given ledger pool.connect rejects with "timeout exceeded when trying to connect"
    When AppendEvent is called with stream_key "account:a-1" and idempotency_key "k-1"
    Then the callback is invoked with a gRPC error status
    And no unhandled promise rejection is raised

  @AC-6 @FR-4 @regression
  Scenario: A failed initial WatchConfig snapshot ends the stream with an error status
    Given the per-user overlay query for namespace "analysis" user "u-1" rejects
    When a client opens WatchConfig for namespace "analysis" user_id "u-1"
    Then the stream is ended with a gRPC error status
    And a later SetConfig of "analysis.backtest.max_duration_seconds" = 600 sends no message to that stream

  @AC-7 @FR-4 @regression
  Scenario: A change committed while the initial snapshot is being built still reaches the new subscriber
    Given a client opens WatchConfig for namespace "analysis" user_id "u-1" and the snapshot read is still in flight
    When "analysis.backtest.max_duration_seconds" is changed to 600 and "config_changed" is broadcast before the snapshot resolves
    Then the subscriber's first SNAPSHOT or a following DELTA carries "analysis.backtest.max_duration_seconds" = 600

  @AC-8 @FR-5 @regression
  Scenario: A subscriber whose broadcast fails is told to reconnect instead of silently dropped
    Given a WatchConfig subscriber on namespace "analysis" user_id "u-1"
    And the per-user overlay query rejects once during a broadcast for "analysis"
    When "config_changed" is broadcast for namespace "analysis"
    Then a log record at error level containing the overlay query's rejection message is captured
    And that subscriber's call is ended with a gRPC error status

  @AC-9 @FR-1 @regression
  Scenario: A change committed while the LISTEN connection is down reaches subscribers after reconnect
    Given xstockstrat-config is running with a WatchConfig subscriber on namespace "analysis" environment "staging"
    And the config LISTEN connection to Postgres is terminated
    And while it is down global key "analysis.backtest.max_duration_seconds" is set to 600 in "staging" and its NOTIFY is lost
    When the config LISTEN connection is re-established
    Then the subscriber receives a message carrying "analysis.backtest.max_duration_seconds" = 600

  @AC-10 @FR-3 @regression
  Scenario: Idempotent AppendEvent returns an error status and releases its client when a query in the transaction fails
    Given ledger pool.connect succeeds and the INSERT inside the idempotent transaction rejects with "connection terminated"
    When AppendEvent is called with stream_key "account:a-1" and idempotency_key "k-2"
    Then the callback is invoked with a gRPC error status
    And the acquired pool client is released
    And no unhandled promise rejection is raised

  @AC-11 @FR-3 @regression
  Scenario: SetConfig returns an error status when the value write fails after the existence gate passes
    Given global key "analysis.backtest.max_duration_seconds" is registered in "staging"
    And the INSERT/UPDATE of config.config_values for that key rejects with "connection terminated"
    When an admin calls SetConfig for that key with value 600
    Then the callback is invoked with a gRPC error status
    And no unhandled promise rejection is raised
