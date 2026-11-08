Feature: config-keys-relative-consumers
  As a platform engineer, I want every service to read its config with the namespace-relative key,
  so that the alias can be removed, the gate's baseline ends empty, and the docs tell the truth.

  @AC-1 @FR-1 @FR-6
  Scenario: Trading resolves a platform key relative to its second namespace with the alias off
    Given namespace "platform" stores key "trading_state" = "REDUCE_ONLY"
    And the marker row "relative_keys_v1" is absent
    And trading subscribes to namespaces "trading" and "platform"
    When trading reads GetString("trading_state", "HALTED")
    Then the value is "REDUCE_ONLY", not the code default "HALTED"

  @AC-2 @FR-1 @FR-6
  Scenario Outline: A rewritten reader returns the stored value with the alias off
    Given the marker row "relative_keys_v1" is absent
    And namespace "<ns>" stores key "<key>" = <stored>
    When the "<service>" reader for "<key>" is evaluated
    Then it returns <stored>, not its code default <default>

    Examples:
      | service    | ns         | key                      | stored | default |
      | indicators | indicators | sandbox.timeout_ms       | 15000  | 5000    |
      | ledger     | ledger     | export.max_window_days   | 30     | 365     |
      | identity   | identity   | jwt.access_ttl_seconds   | 1800   | 900     |
      | notify     | notify     | fanout.min_severity      | 3      | 2       |
      | portfolio  | portfolio  | risk.max_drawdown_pct    | 12.5   | 20.0    |

  @AC-3 @FR-1
  Scenario: Marketdata builds provider keys relative to its namespace
    Given namespace "marketdata" stores "fmp.cache_ttl_hours" = 12 and "finnhub.cache_ttl_hours" = 6
    And the alias is off
    When marketdata resolves the cache TTL for provider "fmp" and for provider "finnhub"
    Then it reads "fmp.cache_ttl_hours" = 12 and "finnhub.cache_ttl_hours" = 6

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
    Then it asserts the constant against the stored set and passes without any applied migration being edited

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
  Scenario: A key stored in two listed namespaces is unattributed
    Given trading's list receiver is [trading, platform]
    And key "trading_state" is stored in both "trading" and "platform"
    When the config-wiring gate runs
    Then the read of "trading_state" is reported as unattributed and exits non-zero

  @AC-10 @FR-4
  Scenario: A prefix-catalog row read relative is not flagged
    Given the heal catalog lists the prefix entry "sandbox." for namespace "indicators"
    And a reader calls getInt("sandbox.timeout_ms")
    When the config-wiring gate runs
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
    Given ledger reads getBool("export.enabled", true) for the first time
    When the watcher logs the read
    Then the record is "config.read_key ns=ledger key=export.enabled"
    And a row with zero reads and no static reader is still kept
