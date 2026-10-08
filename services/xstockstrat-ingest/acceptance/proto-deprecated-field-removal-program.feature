# Promoted from docs/roadmap/features/196-proto-deprecated-field-removal-program/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-196` tag.

Feature: xstockstrat-ingest — deprecated BackfillJob.timeframe string omitted from responses
  Backfill-job responses (GetBackfillStatus, ListBackfillJobs, CancelBackfill) carry timeframe_enum only.

  @AC-6 @FR-3 @regression @feature-196
  Scenario: the deprecated string is omitted, enum twin kept
    Given an ingest.backfill_jobs row stored with timeframe "15m"
    When ingest serializes it as a BackfillJob response
    Then the deprecated string timeframe field is unset
    And the replacement timeframe_enum field is TIMEFRAME_15MIN
