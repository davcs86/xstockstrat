Feature: fix-marketdata-dead-symbol-ingest (bug fix)
  Regression guard for defect report 2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect: marketdata re-ingests symbols that never return bars, every cycle, indefinitely.

  @AC-1 @regression
  Scenario: A symbol that repeatedly returns no bars is backed off instead of re-requested every cycle
    Given a warm symbol that returned no bars in several consecutive ingest cycles
    When the next bar-ingest cycle runs
    Then the symbol is not re-requested from the vendor on every cycle
    And the no-bars condition is reported once per state change rather than every cycle
