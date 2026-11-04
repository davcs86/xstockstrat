Feature: fix-config-keys-drift (bug fix)
  Regression guard for defect report 2026-11-04-config-key-drift-and-subscription-gaps:
  config keys drift from their readers, read keys are missing from the DB, and some values never update live.

  @AC-1 @FR-1 @regression
  Scenario: A stored key never repeats its namespace
    Given the config database after all migrations
    When a row is inserted directly with namespace "marketdata" and key "marketdata.backfill.batch_size"
    Then the insert is rejected by the database check constraint
    And SetConfig with namespace "marketdata" and key "marketdata.backfill.batch_size" returns INVALID_ARGUMENT

  @AC-2 @FR-2 @regression
  Scenario: A consumer resolves a relative key under its subscribed namespace
    Given namespace "indicators" stores key "sandbox.timeout_ms" = 15000 as int
    When indicators reads its sandbox timeout
    Then the value is 15000

  @AC-3 @FR-3 @regression
  Scenario: Healing preserves the effective value instead of the dead row's stored intent
    Given a staging "analysis" row "fundsignal.enabled" = true that no reader consumes
    And no row "analysis.fundsignal.enabled" exists
    When the heal migration runs
    Then "analysis" / "fundsignal.enabled" exists with value false, the reader's code default
    And the prior row is preserved in the premigration snapshot table
    And the discarded-values output lists "analysis fundsignal.enabled: stored true, effective false"

  @AC-4 @FR-3 @regression
  Scenario: When both spellings exist, the row the code reads wins
    Given staging "analysis" rows "backtest.max_duration_seconds" = 300 and "analysis.backtest.max_duration_seconds" = 60
    When the heal migration runs
    Then exactly one row "analysis" / "backtest.max_duration_seconds" exists with value 60
    And a config_audit row records the rename

  @AC-5 @FR-4 @regression
  Scenario: An old-image consumer keeps its values during the rollout
    Given the heal migration has run
    And an old-image consumer still reads "indicators.sandbox.timeout_ms" under namespace "indicators"
    And the stored value is 15000
    When it receives a WatchConfig snapshot for namespace "indicators"
    Then the getter returns 15000, not its code default 5000

  @AC-6 @FR-7 @regression
  Scenario: A concurrency limit shrinks without a restart or a cancelled execution
    Given indicators is running with "sandbox.max_concurrent" = 4 and 4 formulas executing
    When an operator sets "indicators" / "sandbox.max_concurrent" to 2
    Then all 4 in-flight executions complete
    And from then on at most 2 formulas execute concurrently

  @AC-7 @FR-7 @regression
  Scenario: The fundamentals provider switches without a restart
    Given marketdata is running with "fundamentals.provider" = "finnhub"
    When an operator sets "marketdata" / "fundamentals.provider" to "fmp"
    Then the next GetFundamentals call is served by the FMP client

  @AC-8 @FR-8 @regression
  Scenario: The agent observes a config change without a per-call GetConfig
    Given the agent has subscribed to namespace "agent"
    When an operator sets "agent" / "signal.alert_threshold" to 0.9
    Then the next ingest_signal applies threshold 0.9
    And no GetConfig RPC was issued for that read

  @AC-9 @FR-9 @regression
  Scenario: Production UI renders production config
    Given production "platform" / "trading_state" = "HALTED" and staging = "ACTIVE"
    When a production user opens /trader/positions
    Then the HALTED banner is shown

  @AC-10 @FR-10 @regression
  Scenario: A silently stalled config stream is detected and recovered
    Given a watcher with a liveness deadline of 30 seconds
    And its WatchConfig stream stops delivering without closing
    When 30 seconds elapse
    Then the watcher abandons the stream and redials
    And the last snapshot keeps serving reads while redialling
    And a config change made after the redial is applied

  @AC-11 @FR-10 @regression
  Scenario: A server that closes the stream cleanly does not cause a tight reconnect loop
    Given the config server ends every WatchConfig stream immediately after the snapshot
    When the watcher runs for 10 seconds
    Then it opens at most 5 streams
    And the delay between consecutive attempts never decreases

  @AC-12 @FR-11 @regression
  Scenario Outline: A type-mismatched row follows the uniform getter rule
    Given trading "broker.timeout_ms" is stored as <stored_type> <stored>
    When trading reads it with the <getter> getter and default 5000
    Then the result is <result>

    Examples:
      | stored_type | stored | getter | result |
      | int         | 7000   | float  | 7000.0 |
      | float       | 7000.5 | int    | 5000   |
      | string      | "7000" | int    | 5000   |

  @AC-13 @FR-15 @regression
  Scenario: SDD review rejects a new config key without a complete contract
    Given a product spec whose Config Key Changes lists "trading" / "order.max_retries" with no value_type, default, reader or seed migration
    When /sdd-review product-spec runs
    Then criterion 6 fails, citing the config-key contract rule

  @AC-14 @FR-5 @regression
  Scenario: Every read key has a complete seed row in both environments
    Given the config database after all migrations
    When "identity" / "jwt.access_ttl_seconds" is listed with ListKeys in staging and in production
    Then each environment returns value_type "int", default_value "900", a non-empty description and consuming_service "xstockstrat-identity"

  @AC-15 @FR-6 @regression
  Scenario: Orphan rows are removed and snapshotted
    Given "ledger" / "stream.notify_enabled" has no reader in any service
    When the migrations run
    Then ListKeys for namespace "ledger" does not return "stream.notify_enabled"
    And the row is present in the premigration snapshot table

  @AC-16 @FR-7 @regression
  Scenario: A rotated vendor secret is used without a restart
    Given marketdata resolved "marketdata" / "fmp.api_key" at startup
    When an operator rotates "marketdata" / "fmp.api_key" with SetConfig
    Then the next FMP request carries the rotated key

  @AC-17 @FR-7 @regression
  Scenario: The broker HTTP timeout changes for existing broker clients without a restart
    Given trading has an Alpaca broker client built with "broker.timeout_ms" = 5000
    When an operator sets "trading" / "broker.timeout_ms" to 8000
    Then the next Alpaca request from that client uses an 8000 ms HTTP timeout

  @AC-18 @FR-12 @regression
  Scenario: test_formula honours the configured sandbox timeout
    Given staging "indicators" / "sandbox.timeout_ms" = 15000
    When test_formula runs a formula that takes 12 seconds
    Then it returns success, not DEADLINE_EXCEEDED

  @AC-19 @FR-13 @regression
  Scenario: The config-wiring gate has no baseline and rejects new drift
    Given the extended scripts/check-config-wiring.mjs and scripts/config-wiring.json
    When the gate runs with --final on the feature branch
    Then it reports zero findings and the baseline is empty
    And a fixture reader of "analysis" / "x.y" stored as "string" but read with get_int fails the gate as a type mismatch

  @AC-20 @FR-14 @regression
  Scenario: The documented convention matches the enforced one
    Given C-05, CONFIG-9 and docs/patterns/config-governance.md
    When they are read after the change
    Then each states that the stored key is namespace-relative and the FQN is "<namespace>.<key>"
    And none permits unseeded read keys
