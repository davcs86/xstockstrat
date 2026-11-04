Feature: fix-marketdata-dead-symbol-ingest (bug fix)
  Regression guard for defect report 2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect: marketdata re-ingests symbols that never return bars, every cycle, indefinitely.

  Background:
    Given marketdata.stream.bar_ingest_backoff_ms is 3600000 (1 hour)
    And ingest cycles run every 5 minutes from Wednesday 2026-11-04 15:00 UTC, numbered from cycle 0
    And the warm symbols are "LIVE1", "LIVE2", "LIVE3" and "DEAD"

  @AC-1 @FR-1 @FR-3 @regression
  Scenario: A symbol that keeps returning no bars is left out of the ingester's request after the back-off period
    Given "LIVE1", "LIVE2" and "LIVE3" return bars and "DEAD" returns none in every cycle
    When 40 consecutive cycles run
    Then "DEAD" is in the request symbol list for cycles 0 to 12 and absent for cycles 13 to 23
    And "DEAD" is requested again in the probe at cycle 24
    And exactly one "bar ingest: holding symbols that returned no bars" WARN naming "DEAD" is logged over the 40 cycles

  @AC-2 @FR-4 @regression
  Scenario: Whole-empty cycles such as a weekend or holiday never create a hold
    Given every warm symbol returns no bars in each of 36 consecutive cycles (3 hours)
    When the 36 cycles run
    Then all four symbols are in the request symbol list in each of the 36 cycles and no "holding" WARN is logged
    And as the positive control, the same 36 cycles with "LIVE1", "LIVE2" and "LIVE3" returning bars hold "DEAD"

  @AC-3 @FR-4
  Scenario: A partial outage where half or fewer of the requested symbols return bars never creates a hold
    Given 4 symbols "A", "B", "C" and "D" where only "A" and "B" return bars (exactly half) for 36 consecutive cycles
    When the 36 cycles run
    Then no symbol is held and all four are requested in each cycle
    And as the positive control, when "A", "B" and "C" return bars (3 of 4), "D" is held

  @AC-4 @FR-2 @FR-3
  Scenario: A probe that returns bars clears the hold, stores the bars and is reported once
    Given "DEAD" is held and its probe at cycle 24 returns 1 bar
    When cycle 24 runs
    Then 1 bar for "DEAD" is stored
    And exactly one "bar ingest: held symbols returned bars" INFO naming "DEAD" is logged
    And "DEAD" is in the request symbol list at cycle 25

  @AC-5 @FR-4
  Scenario: Per-symbol fetch errors never count as empty
    Given the per-symbol fetch for "AAA" errors in each of 36 consecutive cycles while "LIVE1", "LIVE2" and "LIVE3" return bars
    And "DEAD" is held and its probe at cycle 24 errors
    When the cycles run
    Then "AAA" is never held
    And "DEAD" is in the request symbol list at cycle 25 and is still held

  @AC-6 @FR-5 @characterization
  Scenario: A held symbol stays warm and the read responses are unchanged
    Given "DEAD" is held
    When the warm-set snapshot is read and GetBars("DEAD") and BatchGetBars(["DEAD"]) are called
    Then the snapshot still contains "DEAD"
    And both calls return the same responses as before the hold

  @AC-7 @FR-2
  Scenario: A symbol that leaves the cycle's symbol list is treated as new when it returns
    Given "DEAD" is held
    When a cycle runs whose symbol list omits "DEAD" and the following cycle's list contains it again
    Then "DEAD" is in the request symbol list of the following cycle

  @AC-8 @FR-5
  Scenario: A back-off setting of zero or less disables the hold
    Given marketdata.stream.bar_ingest_backoff_ms is 0, and again -5
    When 36 consecutive cycles run with "DEAD" returning no bars
    Then every warm symbol is in the request symbol list of every cycle and no "holding" WARN is logged

  @AC-9 @FR-1
  Scenario: A held symbol is probed once per period and an empty probe reschedules exactly one period
    Given "DEAD" is held at cycle 12
    When the probe at cycle 24 returns no bars, including when cycle 24 is a whole-empty cycle
    Then the next probe is at cycle 36 (exactly 3600000 ms later) and the delay is never doubled

  @AC-10 @FR-4
  Scenario: A lone dead symbol is never held
    Given the warm set is only "DEAD" and it returns no bars
    When 36 consecutive cycles run
    Then "DEAD" is in the request symbol list of each of the 36 cycles and is never held

  @AC-11 @FR-5
  Scenario: The back-off key is resolved from a real config snapshot and bounded
    Given a config snapshot storing marketdata.stream.bar_ingest_backoff_ms as 1800000
    When the ingester resolves the setting
    Then it returns 1800000 (30 minutes), and a stored 0 returns 0
    And SetConfig accepts 0 and 86400000 and rejects -1 and 86400001 with INVALID_ARGUMENT
