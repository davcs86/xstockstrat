# Promoted from docs/roadmap/features/173-fix-python-config-zero-trap/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-173` tag.
# Durable business rules xstockstrat-ingest guarantees for present-aware config reads — a config value
# deliberately stored as 0 must not silently revert to the coded default.

Feature: xstockstrat-ingest — present-aware config reads (0 is a value, not "unset")
  What xstockstrat-ingest guarantees when an operator deliberately stores a 0 for a 0-meaningful
  config key: the stored 0 is honored (read via get_int_present), not swallowed into the coded default
  by the falsy get_int zero-trap.

  @AC-1 @FR-2 @regression @feature-173
  Scenario: A stored max_retry_attempts of 0 makes zero retry attempts, not the default 3
    Given the ingest config watcher has a snapshot where "ingest.backfill.max_retry_attempts" is present with int value 0
    And "ingest.backfill.retry_on_failure" is true
    When the ingest servicer computes the effective retry-attempt count for a transiently-failing backfill
    Then the effective retry-attempt count is 0
    And it is NOT the coded default of 3

  @AC-2 @FR-2 @regression @feature-173
  Scenario: A stored dedup_window_hours of 0 disables the dedup window, not the default 24
    Given the ingest config watcher has a snapshot where "ingest.signals.dedup_window_hours" is present with int value 0
    When the ingest service reads the dedup window
    Then the value returned is 0
    And it is NOT the coded default of 24

  @AC-3 @FR-1 @FR-3 @regression @feature-173
  Scenario Outline: The present-aware accessor honors a present zero and still defaults when unset
    Given the ingest config watcher has a snapshot for key "<key>" that is "<presence>" with numeric value <stored>
    When the service reads "<key>" through the present-aware accessor with coded default <default>
    Then the value returned is <expected>

    Examples:
      | key                                 | presence | stored | default | expected |
      | ingest.backfill.max_retry_attempts  | present  | 0      | 3       | 0        |
      | ingest.signals.dedup_window_hours   | present  | 0      | 24      | 0        |
      | ingest.backfill.max_retry_attempts  | absent   | -      | 3       | 3        |
