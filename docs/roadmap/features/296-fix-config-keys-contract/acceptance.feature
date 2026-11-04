Feature: fix-config-keys-contract (bug fix, Release B — contract)
  Cutover of stored config keys to the namespace-relative canonical form (operator decision 1 of feature 295).

  @AC-1 @FR-1 @regression
  Scenario: A stored key never repeats its namespace
    Given the config database after all migrations
    When a row is inserted directly with namespace "marketdata" and key "marketdata.backfill.batch_size"
    Then the insert is rejected by the database check constraint
    And SetConfig by an admin with namespace "marketdata" and key "marketdata.backfill.batch_size" returns INVALID_ARGUMENT

  @AC-2 @FR-2 @regression
  Scenario: A consumer resolves a relative key under its subscribed namespace
    Given namespace "indicators" stores key "sandbox.timeout_ms" = 15000 as int
    When indicators reads its sandbox timeout
    Then the value is 15000

  @AC-3 @FR-4 @regression
  Scenario: A previous-image consumer keeps its values during the rollout
    Given the rename migration has run
    And a previous-image consumer still reads "indicators.sandbox.timeout_ms" under namespace "indicators"
    And the stored value is 15000
    When it receives a WatchConfig snapshot for namespace "indicators"
    Then the getter returns 15000, not its code default 5000

  @AC-4 @FR-4 @regression
  Scenario: Rolling back to the previous images after the rename keeps stored values
    Given the rename migration has run and "trading" / "risk.bracket_orders_enabled" is stored as false
    When the deployment is rolled back to feature 295's images without running the down migration
    Then the trading image reads "trading.risk.bracket_orders_enabled" as false, not its code default true

  @AC-5 @FR-1 @regression
  Scenario: The previous-image reconciliation poller can still escalate during rollout
    Given the trading poller sends SetConfig "platform" / "platform.trading_state" = "REDUCE_ONLY" as internal caller "trading-reconciliation-poller"
    When the contract config server handles it
    Then the row "platform" / "trading_state" holds "REDUCE_ONLY"
    And a WARN records the canonicalised internal-caller key

  @AC-6 @FR-5 @regression
  Scenario: The gate rejects a prefixed read
    Given a fixture reader of namespace "ledger" calling getInt("ledger.export.max_window_days")
    When the config-wiring gate runs with --final
    Then it reports a prefixed-read finding and exits non-zero

  @AC-7 @FR-9 @regression
  Scenario: A dead row is deleted only with static and runtime evidence
    Given "ledger" / "stream.notify_enabled" has no static reader
    And a full production release of read-key logs shows no read of it
    And it is in the signed allowlist
    When the dead-row migration runs
    Then the row is removed and preserved in the snapshot table
