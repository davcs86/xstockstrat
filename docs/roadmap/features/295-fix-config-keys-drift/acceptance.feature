Feature: fix-config-keys-drift (bug fix, Release A — expand)
  Regression guard for defect report 2026-11-04-config-key-drift-and-subscription-gaps:
  config keys drift from their readers, read keys are missing from the DB, and some values never update live.
  The spelling cutover (relative keys, CHECK, rejection, alias activation) is feature 296.

  @AC-1 @FR-1 @regression
  Scenario: SetConfig with either spelling updates the row the service reads
    Given staging stores "marketdata" / "marketdata.backfill.batch_size" = 1000 as int
    When an admin calls SetConfig with namespace "marketdata" and key "backfill.batch_size" and value 500
    Then the row "marketdata.backfill.batch_size" holds 500
    And no row "backfill.batch_size" exists in namespace "marketdata"

  @AC-2 @FR-1 @preserve
  # Preserve-guard (C-15): green on today's code by design; it must stay green once the dormant alias ships.
  Scenario: Without the rename marker the snapshot carries only stored spellings
    Given no key-rename marker exists in the config database
    When a subscriber receives the WatchConfig snapshot for namespace "indicators"
    Then the snapshot keys are exactly the stored keys of namespace "indicators"

  @AC-3 @FR-3 @regression
  Scenario: A dead bare row is removed and its intent is reported, not applied
    Given a staging "analysis" row "fundsignal.enabled" = true that no reader consumes
    And the reader consumes "analysis.fundsignal.enabled", which has no row
    When the heal migrations run
    Then "analysis" / "analysis.fundsignal.enabled" exists with value false, the reader's code default
    And "analysis" / "fundsignal.enabled" no longer exists and is preserved in the premigration snapshot table
    And the discarded-values report lists "analysis fundsignal.enabled: stored true, effective false"

  @AC-4 @FR-3 @regression
  Scenario: When both spellings exist, the row the code reads wins
    Given staging "analysis" rows "backtest.max_duration_seconds" = 300 and "analysis.backtest.max_duration_seconds" = 60
    When the heal migrations run
    Then exactly one row remains for that key, "analysis.backtest.max_duration_seconds" = 60
    And a config_audit row records the deletion of "backtest.max_duration_seconds"

  @AC-5 @FR-3 @regression
  Scenario: A per-user row in an unread spelling is snapshotted and reported, not silently applied
    Given user "u-295" has a staging "analysis" row "fundsignal.enabled" = true
    When the heal migrations run
    Then that per-user row is preserved in the premigration snapshot table
    And the discarded-values report lists it with user "u-295"
    And user "u-295"'s effective "analysis.fundsignal.enabled" is unchanged

  @AC-6 @FR-7 @regression
  Scenario: A concurrency limit shrinks without a restart or a cancelled execution
    Given indicators is running with "indicators.sandbox.max_concurrent" = 4 and 4 formulas executing
    When an operator sets it to 2
    Then all 4 in-flight executions complete
    And from then on at most 2 formulas execute concurrently

  @AC-7 @FR-7 @regression
  Scenario: The fundamentals provider switches without a restart
    Given marketdata is running with "marketdata.fundamentals.provider" = "finnhub"
    When an operator sets it to "fmp"
    Then the next GetFundamentals call is served by the FMP client

  @AC-8 @FR-8 @regression
  Scenario: The agent observes a config change without a per-call GetConfig
    Given the agent has subscribed to namespace "agent"
    When an operator sets "agent" / "signal.alert_threshold" to 0.9
    Then the next ingest_signal applies threshold 0.9
    And no GetConfig RPC was issued for that read

  @AC-9 @FR-9 @regression
  Scenario: Production UI renders production config
    Given production "platform.trading_state" = "HALTED" and staging = "ACTIVE"
    When a production user opens /trader/positions
    Then the HALTED banner is shown

  @AC-10 @FR-10 @regression
  Scenario Outline: A silently stalled client stream is detected and recovered
    Given the <service> watcher with a liveness deadline of 30 seconds
    And its WatchConfig stream stops delivering without closing
    When 30 seconds elapse
    Then the watcher abandons the stream and redials
    And the last snapshot keeps serving reads while redialling
    And a config change made after the redial is applied

    Examples:
      | service    |
      | indicators |
      | trading    |
      | ledger     |
      | agent      |

  @AC-11 @FR-10 @regression
  Scenario: A server that closes the stream cleanly does not cause a tight reconnect loop
    Given the config server ends every WatchConfig stream immediately after the snapshot
    When the watcher runs for 10 seconds
    Then it opens at most 5 streams
    And the delay between consecutive attempts never decreases

  @AC-12 @FR-11 @regression
  Scenario Outline: A type-mismatched or absent value follows the uniform getter rule
    Given trading "trading.broker.timeout_ms" is <stored>
    When trading reads it with the <getter> getter and default 5000
    Then the result is <result>
    And a WARN naming "trading.broker.timeout_ms" is logged: <warn>

    Examples:
      | stored              | getter | result | warn |
      | int 7000            | float  | 7000.0 | no   |
      | float 7000.5        | int    | 5000   | yes  |
      | string "7000"       | int    | 5000   | yes  |
      | absent from snapshot | int   | 5000   | yes  |

  @AC-13 @FR-15 @regression
  Scenario: SDD review rejects a new config key without a complete contract
    Given a product spec whose Config Key Changes lists "trading" / "trading.order.max_retries" with no value_type, default, reader or seed migration
    When /sdd-review product-spec runs
    Then criterion 6 fails, citing the config-key contract rule

  @AC-14 @FR-5 @regression
  Scenario: Every read key has a complete seed row in both environments
    Given the config database after all migrations
    When "identity" / "identity.jwt.access_ttl_seconds" is listed with ListKeys in staging and in production
    Then each environment returns value_type "int", default_value "900", a non-empty description and consuming_service "xstockstrat-identity"

  @AC-15 @FR-6 @regression
  Scenario: Orphan rows are removed and snapshotted
    Given "ledger" / "stream.notify_enabled" has no reader in any spelling
    When the migrations run
    Then ListKeys for namespace "ledger" does not return "stream.notify_enabled"
    And the row is present in the premigration snapshot table

  @AC-16 @FR-7 @regression
  Scenario: A rotated vendor secret is used without a restart
    Given marketdata resolved "marketdata" / "fmp.api_key" at startup
    When an operator rotates it with SetConfig
    Then the next FMP request carries the rotated key

  @AC-17 @FR-7 @regression
  Scenario: The broker HTTP timeout changes for existing broker clients without a restart
    Given trading has an Alpaca broker client built with "trading.broker.timeout_ms" = 5000
    When an operator sets it to 8000
    Then the next Alpaca request from that client uses an 8000 ms timeout

  @AC-18 @FR-12 @regression
  Scenario: test_formula honours the configured sandbox timeout
    Given staging "indicators.sandbox.timeout_ms" = 15000 and "indicators.sandbox.startup_grace_ms" = 5000
    When test_formula runs a formula that takes 12 seconds
    Then it returns success, not DEADLINE_EXCEEDED

  @AC-19 @FR-13 @regression
  Scenario: The config-wiring gate has no baseline and rejects new drift
    Given the extended scripts/check-config-wiring.mjs and scripts/config-wiring.json
    When the gate runs with --final on the feature branch
    Then it reports zero findings and the baseline is empty
    And a fixture reader of "analysis" / "analysis.x.y" stored as "string" but read with get_int fails the gate as a type mismatch
    And a fixture getter on an unregistered receiver fails the gate as unattributed

  @AC-20 @FR-14 @regression
  Scenario: The documented convention matches the enforced one
    Given C-05, CONFIG-9 and docs/patterns/config-governance.md after the change
    When the config-wiring gate's doc check runs
    Then each states that the stored key equals the reader's exact spelling and every read key is seeded
    And none permits unseeded read keys

  @AC-21 @FR-2 @regression
  Scenario: A silently dead config-server change feed is detected and recovered
    Given the config server's LISTEN connection stops delivering notifications without closing
    And an operator then sets "indicators" / "indicators.sandbox.timeout_ms" to 15000
    When the server's change-feed heartbeat deadline elapses
    Then the server reconnects its LISTEN feed and resyncs
    And the indicators subscriber receives 15000

  @AC-22 @FR-4 @regression
  Scenario: The inventory tool never prints secret material
    Given the config database holds secret row "marketdata" / "alpaca.api_key"
    When the operator runs the inventory tool from the indicators DO console
    Then the output lists that row's namespace, key, environment, value_type and is_secret
    And the output contains no value_encrypted bytes and no plaintext secret value

  @AC-23 @FR-7 @regression
  Scenario: A timed-out backtest does not let compute threads exceed the limit
    Given the analysis compute limit is 4
    And 4 backtests occupy all compute slots
    When one backtest times out while its thread keeps running
    Then a fifth compute task does not start until that thread finishes

  @AC-24 @FR-5 @regression
  Scenario: A row whose stored value differs from the code default is not retyped
    Given a migration-assertion fixture row "trading" / "trading.order.max_retries" stored as string "7" whose reader is an int getter with code default 3
    When the seed-parity migration runs
    Then that row's value_type and value_data are unchanged
    And the sign-off report lists "trading trading.order.max_retries: stored string 7, reader int default 3"

  @AC-25 @FR-1 @regression
  Scenario: Internal-caller grants and write bounds match on the canonical key
    Given the grant for "trading-reconciliation-poller" on "platform" / "platform.trading_state"
    When that caller sends SetConfig "platform" / "trading_state" = "REDUCE_ONLY"
    Then the stored "platform.trading_state" row holds "REDUCE_ONLY"
    And SetConfig "analysis" / "opportunity.max_universe_size" = 0 by an admin returns INVALID_ARGUMENT from the [1,1000] bound

  @AC-26 @FR-2 @regression
  Scenario: A no-op reload or re-send does not report a config change
    Given a subscriber of namespace "ledger" that counts distinct snapshot versions
    When the server runs its periodic full reload and its liveness re-send with no row changed
    Then the subscriber observes no new snapshot version
    And when an operator then sets "ledger" / "ledger.export.max_window_days" to 180 it observes exactly one new version

  @AC-27 @FR-11 @regression
  Scenario Outline: Every language's getters follow the uniform rule
    Given <service> stores "<key>" as int 7
    When it is read with the float getter and default 1.5
    Then the result is 7.0 with no WARN

    Examples:
      | service    | key                                   |
      | analysis   | analysis.opportunity.signal_rank_weight |
      | notify     | notify.fanout.min_confidence_threshold |
      | portfolio  | portfolio.risk.max_drawdown_pct        |
