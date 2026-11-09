Feature: config-keys-relative-consumers
  As a platform engineer, I want every service to read its config with the namespace-relative key,
  so that the alias can be removed, the gate's baseline ends empty, and the docs tell the truth.

  @AC-1 @FR-1 @FR-6
  Scenario: Trading gates an order on the platform key read through its platform watcher with the alias off
    # Bound test: TestPlaceOrder_GatesOnPlatformWatcher_AliasOff (trading_state_gate_test.go). Harness: TradingService{
    #   cfgW: MustSnapshotWatcher("trading", {"trading_state": ACTIVE}),
    #   platformCfgW: MustSnapshotWatcher("platform", {"trading_state": REDUCE_ONLY}),
    #   brokers: {"acct-1": {userID: "u1", brokerType: ALPACA}}, portfolio: GetPosition -> NotFound },
    # request with ClientOrderId and TradingMode PAPER, context user "u1". Without those, PlaceOrder returns
    # InvalidArgument/NotFound/PermissionDenied before the gate and the test is vacuous.
    Given namespace "platform" stores key "trading_state" = "REDUCE_ONLY"
    And namespace "trading" stores key "trading_state" = "ACTIVE"
    And the marker row "relative_keys_v1" is absent
    And trading reads namespace "trading" through its trading watcher and namespace "platform" through a separate platform watcher
    When a user places an exposure-increasing BUY order for "AAPL" on their own account, which holds no AAPL position
    Then the order is rejected with FailedPrecondition "trading reduce-only: no existing position in AAPL; order would increase exposure"
    And it is not rejected as "trading halted: platform.trading_state=HALTED" (the code default) and not accepted (the "trading" namespace's ACTIVE)

  @AC-2 @FR-1 @FR-6
  Scenario Outline: A rewritten reader returns the stored value with the alias off
    Given the marker row "relative_keys_v1" is absent
    And namespace "<ns>" stores key "<key>" = <stored>
    When the "<service>" reader for "<key>" is evaluated
    Then it returns <stored>, not its code default <default>
    # In every row <stored> differs from <default>, so a reader that misses the key fails the row.

    Examples:
      | service    | ns         | key                      | stored | default |
      | indicators | indicators | sandbox.timeout_ms       | 15000  | 5000    |
      | ledger     | ledger     | export.max_window_days   | 30     | 365     |
      | identity   | identity   | jwt.access_ttl_seconds   | 1800   | 900     |
      | notify     | notify     | fanout.min_severity      | 3      | 2       |
      | portfolio  | portfolio  | risk.max_drawdown_pct    | 0.2    | 0.1     |

  @AC-3 @FR-1
  Scenario: Marketdata builds provider keys relative to its namespace
    Given namespace "marketdata" stores "fmp.cache_ttl_hours" = 12 and "finnhub.cache_ttl_hours" = 6
    And the alias is off
    When marketdata resolves the cache TTL for provider "fmp" and for provider "finnhub"
    Then the TTL is 12 hours for provider "fmp" and 6 hours for provider "finnhub", not the code default

  @AC-4 @FR-1
  Scenario: Analysis reads the marketdata provider through its second watcher
    Given the analysis service has a second watcher for namespace "marketdata" storing "fundamentals.provider" = "edgar"
    And the alias is off
    When the fundamentals signal producer resolves its provider
    Then it reads "fundamentals.provider" and gets "edgar", not ""

  @AC-5 @FR-1
  Scenario: The trader positions banner reads the relative platform key
    Given the platform config returns values {"trading_state": "REDUCE_ONLY"}
    When an operator opens /trader/positions
    Then the REDUCE_ONLY banner is shown

  @AC-6 @FR-2
  Scenario: A migration-coupled test follows the generated stored set
    Given the portfolio signal-prune interval constant is "watchlist.signal_prune_interval_seconds"
    And scripts/config-wiring-stored.json holds that key under namespace "portfolio"
    When the portfolio test TestSignalPrune_IntervalReadsSeededRow runs
    Then the test passes and no applied migration file is modified

  @AC-7 @FR-3
  Scenario: The baseline is empty and the kind is gone
    Given every consumer literal is relative
    When "node scripts/check-config-wiring.mjs --final" runs
    Then it exits 0 and scripts/config-wiring.json holds no prefixed-read entry
    And a baseline file that still contains an entry of kind "prefixed-read" makes the gate exit 2

  @AC-8 @FR-3
  Scenario: A new prefixed read cannot be baselined
    Given namespace "ledger" seeds "export.max_window_days" and a new reader calls getInt("ledger.export.max_window_days")
    When the config-wiring gate runs with --final
    Then it reports a blocking prefixed-read finding for ledger / ledger.export.max_window_days and exits non-zero

  @AC-9 @FR-4
  Scenario: A list receiver reading a relative key is unattributed
    # Characterization only: attribute() is unchanged and picks a listed namespace only by a "<ns>." key prefix;
    # no consumer reads through a list receiver after this feature (trading's s.cfgW is "trading").
    Given a registry receiver that lists the namespaces ["trading", "platform"]
    And a reader on that receiver calls GetString("trading_state", "HALTED")
    And key "trading_state" is stored in both "trading" and "platform"
    When the config-wiring gate runs with --final
    Then the read of "trading_state" on that receiver is reported as unattributed
    And the gate exits non-zero

  @AC-10 @FR-4
  Scenario: A relative read under a prefixed prefix-catalog row is judged by the stored set
    # Characterization only (operator sign-off 2026-11-09): excluded() is unchanged; the read is clean because
    # its relative row is stored, not because the prefix-catalog entry matches it.
    Given the heal catalog lists the prefix entry "indicators.sandbox." for namespace "indicators"
    And namespace "indicators" stores "sandbox.timeout_ms"
    And a reader on an "indicators" receiver calls getInt("sandbox.timeout_ms")
    When the config-wiring gate runs with --final
    Then no read-unseeded or prefixed-read finding is reported for it

  @AC-11 @FR-5
  Scenario: The caveat is gone and the scan covers consumer banners
    Given the contract release and this feature are complete
    When "node scripts/check-config-wiring.mjs --doc-check" runs
    Then it passes
    And a services/xstockstrat-trading/CLAUDE.md that contains "via the alias until" makes it fail
    And no CLAUDE.md contains "Target form is namespace-relative, cutover in feature 296"

  @AC-12 @FR-7
  Scenario: Ledger logs the relative key as read evidence
    # Bound tests: (a) a key-matching ledger reader test (getBool("export.enabled") = false is rejected with
    # FAILED_PRECONDITION; red against the prefixed reader); (b) the core log-format test configWatcher.test.ts with
    # KEY = "export.enabled"; (c) the clause below is bound to the seeded-unread entry ledger/stream.notify_enabled
    # (owner feature 305) plus baseline 1 @AC-7: if the stored row left, the entry goes STALE and the gate is red.
    Given ledger's watcher holds a snapshot in which "export.enabled" = false
    When ExportEvents reads getBool("export.enabled", true) twice
    Then ExportEvents is rejected with FAILED_PRECONDITION
    And the watcher logs exactly one "config.read_key ns=ledger key=export.enabled" record before its next coverage tick
    And "ledger" / "stream.notify_enabled", a row with zero reads and no static reader, is still kept

  @AC-13 @FR-4
  Scenario: The registry's dynamic key lists are respelled relative
    Given scripts/config-wiring.json registers the dynamic keys of marketdata's resolveFundamentals and GetFundamentalsMulti as "marketdata.fmp.cache_ttl_hours" and "marketdata.finnhub.cache_ttl_hours"
    When the lists are respelled and "node scripts/check-config-wiring.mjs --final" runs
    Then the registered keys are "fmp.cache_ttl_hours" and "finnhub.cache_ttl_hours"
    And the gate exits 0 and reports no prefixed-read finding for them

  @AC-14 @FR-4
  Scenario: The broker.paper defect entry is respelled and stays owned by its defect
    Given scripts/config-wiring.json holds a read-unseeded entry for namespace "trading" and key "trading.broker.paper" owned by defect 2026-11-06-trading-broker-paper-env-derived-default-unseedable
    When the entry is respelled and "node scripts/check-config-wiring.mjs --final" runs
    Then the entry's key is "broker.paper" with the same owner
    And the gate exits 0 and prints no STALE line for it

  @AC-15 @FR-5
  Scenario: The strat-lab backtest skill names the relative key
    Given plugins/strat-lab/skills/backtest/SKILL.md line 81 names the analysis key "analysis.engine.fundamentals_blend_strategy_id"
    When this feature is complete
    Then the line names key "engine.fundamentals_blend_strategy_id" under namespace "analysis"
    And the string "analysis.engine.fundamentals_blend_strategy_id" no longer appears in the file

  @AC-16 @FR-2
  Scenario: The sandbox-keys operator check expects the relative spelling
    Given namespace "indicators" stores "sandbox.timeout_ms" = 5000, "sandbox.memory_bytes" = 134217728 and "sandbox.allowed_imports" = "numpy,pandas,math,statistics" in the global scope
    And the migration-031 snapshot table config.config_values_premigration_031 exists
    When "python -m app.maintenance.sandbox_keys_check" runs against that database
    Then it exits 0 and reports PASS
    And a database that still stores "indicators.sandbox.timeout_ms" makes it exit 1

  @AC-17 @FR-2
  Scenario Outline: A canonical config double rejects a key spelled with a namespace prefix
    Given the <lang> canonical config double <double> for namespace "<ns>"
    When a test <trigger>s it with the key "<bad_key>"
    Then the test fails immediately, naming "<bad_key>" and its relative spelling
    And built with "any.key" = 7 it returns 7 for "any.key"
    # <trigger> is "build" for constructors (Go MustSnapshotWatcher, Python snapshot_watcher: they return a real
    # watcher whose reads go through the shared core, which is not edited) and "read" for standalone fakes.
    # trading's MustSnapshotWatcher rejects BOTH "trading." and "platform." prefixes in either namespace, so a stale
    # "platform.trading_state" fixture cannot pass and then match the HALTED code default.

    Examples:
      | lang   | double                                              | ns         | trigger | bad_key              |
      | Go     | trading config.MustSnapshotWatcher                  | trading    | build   | trading.any.key      |
      | Go     | trading config.MustSnapshotWatcher                  | trading    | build   | platform.any.key     |
      | Go     | trading config.MustSnapshotWatcher                  | platform   | build   | platform.any.key     |
      | Go     | marketdata config.MustSnapshotWatcher               | marketdata | build   | marketdata.any.key   |
      | Go     | marketdata fakeCfg                                  | marketdata | read    | marketdata.any.key   |
      | Go     | marketdata fakeIntGetter                            | marketdata | read    | marketdata.any.key   |
      | Go     | portfolio config.MustSnapshotWatcher                | portfolio  | build   | portfolio.any.key    |
      | Go     | portfolio fakeConfig                                | portfolio  | read    | portfolio.any.key    |
      | Python | analysis snapshot_watcher(namespace="analysis")     | analysis   | build   | analysis.any.key     |
      | Python | analysis snapshot_watcher(namespace="marketdata")   | marketdata | build   | marketdata.any.key   |
      | Python | indicators snapshot_watcher                         | indicators | build   | indicators.any.key   |
      | Python | ingest snapshot_watcher                             | ingest     | build   | ingest.any.key       |
      | Python | agent install_watcher                               | agent      | build   | agent.any.key        |
      | Python | agent install_watcher                               | indicators | build   | indicators.any.key   |
