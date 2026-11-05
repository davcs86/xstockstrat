Feature: fix-config-keys-contract (bug fix, Release B — contract)
  Cutover of stored config keys to the namespace-relative canonical form (operator decision 1 of feature 295).

  @AC-1 @FR-1 @regression
  Scenario: A stored key never repeats its namespace
    Given the config database after all migrations
    When a row is inserted directly with namespace "marketdata" and key "marketdata.backfill.batch_size"
    Then the insert is rejected by the database check constraint
    And SetConfig by an admin with namespace "marketdata" and key "marketdata.backfill.batch_size" returns INVALID_ARGUMENT
    And create_key with namespace "marketdata" and key "marketdata.backfill.batch_size" returns INVALID_ARGUMENT
    And GetSecret by an allow-listed caller for namespace "marketdata" and key "marketdata.alpaca.api_key" returns INVALID_ARGUMENT

  @AC-2 @FR-2 @regression
  Scenario: A consumer resolves a relative key under its subscribed namespace
    Given namespace "indicators" stores key "sandbox.timeout_ms" = 15000 as int
    And the indicators getter literal is "sandbox.timeout_ms", not "indicators.sandbox.timeout_ms"
    And the alias is disabled by removing the marker row "relative_keys_v1"
    When indicators reads its sandbox timeout
    Then the value is 15000, not its code default 5000

  @AC-3 @FR-4 @regression
  Scenario: A previous-image consumer keeps its values during the rollout
    Given the rename migration has run and marker row "relative_keys_v1" exists in config.config_markers
    And a previous-image consumer still reads "indicators.sandbox.timeout_ms" under namespace "indicators"
    And the stored value is 15000
    When it receives a WatchConfig snapshot for namespace "indicators"
    Then the getter returns 15000, not its code default 5000

  @AC-4 @FR-4 @regression
  Scenario: Rolling back to the previous images after the rename keeps stored values
    Given the rename migration has run, marker row "relative_keys_v1" exists, and "trading" / "risk.bracket_orders_enabled" is stored as false
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

  @AC-8 @FR-3 @regression
  Scenario: The rename migration strips the prefix, activates the alias and orders its side effects
    Given namespace "marketdata" stores key "marketdata.backfill.batch_size" = 500 as int in the global scope
    When the rename migration runs
    Then namespace "marketdata" stores key "backfill.batch_size" = 500 and no key beginning with "marketdata." remains
    And config.config_markers holds marker "relative_keys_v1" with updated_by "system:config-migration-<NNN>"
    And pg_notify "config_changed" with payload {"marker":"relative_keys_v1"} is sent in the same transaction
    And the snapshot row precedes the migration's audit row, and the per-(namespace, environment) pg_notify follows both

  @AC-9 @FR-3 @regression
  Scenario: Twin rows resolve to the value the code reads, in every scope
    Given namespace "indicators" stores both "sandbox.timeout_ms" = 5000 and "indicators.sandbox.timeout_ms" = 15000 in the global scope
    And the reader catalog marks "indicators.sandbox.timeout_ms" as the key the code reads
    And user "u-100" has a per-user row "indicators" / "indicators.sandbox.timeout_ms" = 20000
    When the rename migration runs
    Then the global row "sandbox.timeout_ms" holds 15000 and the 5000 twin is preserved in the snapshot table
    And user "u-100" has a per-user row "sandbox.timeout_ms" = 20000

  @AC-10 @FR-6 @regression
  Scenario: config-ui and the agent show the FQN and write relative keys
    Given namespace "marketdata" stores key "backfill.batch_size"
    When an operator opens /config-ui for namespace "marketdata" and the agent runs list_config_keys
    Then both display "marketdata.backfill.batch_size"
    And saving a new value from config-ui, or calling set_config, sends key "backfill.batch_size" with namespace "marketdata"

  @AC-11 @FR-7 @regression
  Scenario: The relative convention is documented and the transition note is gone
    Given the contract release is complete
    When docs/sdd/constitution.md C-05, docs/patterns/config-governance.md and every service CLAUDE.md config table are read
    Then each states that the stored key is namespace-relative and the FQN is display-only
    And no file contains the 295 transition note

  @AC-12 @FR-8 @regression
  Scenario: The alias-removal follow-up feature exists
    Given this feature is code-completed
    When docs/roadmap/features is listed
    Then a feature directory exists whose product-spec.md removes the alias, the write tolerance and the internal-caller exception
    And its product spec declares "Depends on" this feature

  @AC-13 @FR-9 @regression
  Scenario: A row is kept when a subscriber's coverage log is missing
    Given "ledger" / "stream.notify_enabled" has no static reader and zero "config.read_key" hits in either spelling over the staging release window
    And subscriber "xstockstrat-notify" did not log "config.read_coverage" for namespace "ledger" in one 6 h window
    When the dead-row migration runs
    Then the row "ledger" / "stream.notify_enabled" is not deleted

  @AC-14 @FR-9 @regression
  Scenario: A namespace with a UI reader is never proven dead
    Given namespace "ui" row "banner.enabled" has no static reader in the services and zero "config.read_key" hits
    And xstockstrat-ui reads namespace "ui"
    When the dead-row migration runs
    Then the row "ui" / "banner.enabled" is not deleted
