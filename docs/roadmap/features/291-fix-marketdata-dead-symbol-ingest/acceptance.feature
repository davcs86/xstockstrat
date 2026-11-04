Feature: fix-marketdata-dead-symbol-ingest (bug fix)
  Regression guard for defect report 2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect: marketdata re-ingests symbols that never return bars, every cycle, indefinitely.

  @AC-1 @FR-1 @FR-3 @regression
  Scenario: A symbol that repeatedly returns no bars is backed off instead of re-requested every cycle
    Given a warm symbol that returned no bars across informative ingest cycles for at least the back-off period
    When the next bar-ingest cycle runs
    Then the symbol is not re-requested from the vendor on every cycle
    And the no-bars condition is reported once per state change rather than every cycle

  @AC-2 @FR-4 @regression
  Scenario: Whole-empty cycles such as a weekend or holiday never create a hold
    Given every warm symbol returns no bars for hours of consecutive cycles
    And the same setup with a live majority holds the dead symbol
    When the cycles run
    Then no symbol is held

  @AC-3 @FR-4
  Scenario: A partial outage where at most half of the requested symbols return bars never creates a hold
    Given four warm symbols of which only half or fewer return bars for hours
    And the same setup with a majority returning bars holds the dead symbol
    When the cycles run
    Then no symbol is held

  @AC-4 @FR-2 @FR-3
  Scenario: A probe that returns bars clears the hold, stores the bars and is reported once
    Given a held symbol whose probe returns bars
    When the probe cycle runs
    Then the bars are stored and the hold is cleared
    And one recovery line is logged and the symbol is requested on the next cycle

  @AC-5 @FR-4
  Scenario: Per-symbol fetch errors never count as empty
    Given a symbol whose per-symbol fetch errors for hours while its peers return bars
    And a held symbol whose probe errors
    When the cycles run
    Then the erroring symbol is not held and the held probe is retried on the next cycle

  @AC-6 @FR-5 @characterization
  Scenario: A held symbol stays warm and its responses are unchanged
    Given a held symbol
    When the warm set and GetBars/BatchGetBars responses are read
    Then the symbol is still in the warm set and no response contract changes

  @AC-7 @FR-2
  Scenario: A symbol that leaves the cycle's symbol list loses its hold entry
    Given a held symbol
    When a cycle runs whose symbol list no longer contains it
    Then its hold entry is dropped and it is requested if it returns to the list

  @AC-8 @FR-5
  Scenario: A back-off setting of zero or less disables the hold
    Given marketdata.stream.bar_ingest_backoff_ms is 0 or less
    When ingest cycles run
    Then every warm symbol is requested every cycle and no hold state is kept

  @AC-9 @FR-1
  Scenario: A held symbol is probed once per period and an empty probe reschedules exactly one period
    Given a held symbol
    When a probe returns no bars, including in a whole-empty cycle
    Then the next probe is scheduled exactly one back-off period later and the delay never doubles

  @AC-10 @FR-4
  Scenario: A lone dead symbol is never held
    Given a warm set containing only the dead symbol
    When the cycles run
    Then the symbol is requested every cycle and never held

  @AC-11 @FR-5
  Scenario: The back-off key is resolved from a real config snapshot and bounded
    Given a config snapshot holding marketdata.stream.bar_ingest_backoff_ms
    When the ingester resolves the setting
    Then it returns the stored value
    And SetConfig rejects a value outside 0 to 86400000
