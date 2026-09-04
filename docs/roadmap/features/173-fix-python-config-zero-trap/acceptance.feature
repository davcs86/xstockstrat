Feature: fix-python-config-zero-trap (bug fix)
  Regression guard for comment-audit report item 3 (CF-N10): a config value deliberately stored as 0
  must not silently revert to the coded default in the ingest (and indicators) config watchers.
  Scenarios bind concrete, confirmed 0-meaningful keys.

  @AC-1 @FR-2 @regression
  Scenario: A stored max_retry_attempts of 0 makes zero retry attempts, not the default 3
    Given the ingest config watcher has a snapshot where "ingest.backfill.max_retry_attempts" is present with int value 0
    And "ingest.backfill.retry_on_failure" is true
    When the ingest servicer computes the effective retry-attempt count for a transiently-failing backfill
    Then the effective retry-attempt count is 0
    And it is NOT the coded default of 3

  @AC-2 @FR-2 @regression
  Scenario: A stored dedup_window_hours of 0 disables the dedup window, not the default 24
    Given the ingest config watcher has a snapshot where "ingest.signals.dedup_window_hours" is present with int value 0
    When the ingest service reads the dedup window
    Then the value returned is 0
    And it is NOT the coded default of 24

  @AC-3 @FR-1 @FR-3 @regression
  Scenario Outline: The present-aware accessor honors a present zero and still defaults when unset
    Given the ingest config watcher has a snapshot for key "<key>" that is "<presence>" with numeric value <stored>
    When the service reads "<key>" through the present-aware accessor with coded default <default>
    Then the value returned is <expected>

    Examples:
      | key                                 | presence | stored | default | expected |
      | ingest.backfill.max_retry_attempts  | present  | 0      | 3       | 0        |
      | ingest.signals.dedup_window_hours   | present  | 0      | 24      | 0        |
      | ingest.backfill.max_retry_attempts  | absent   | -      | 3       | 3        |

  @AC-4 @FR-2 @FR-3 @regression
  Scenario: An empty allowed_imports denies all sandbox imports instead of reverting to the permissive default
    Given the indicators config watcher has a snapshot where "indicators.sandbox.allowed_imports" is present with string value ""
    When a formula that imports numpy is executed in the indicators sandbox
    Then the import is rejected because the resolved allow-list is empty
    And the allow-list is NOT the coded default "numpy,pandas,math,statistics"

