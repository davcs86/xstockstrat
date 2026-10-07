# Promoted from docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-198` tag.
# Durable business rules xstockstrat-ingest already guarantees; a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-ingest - fundamentals backfill is a distinct data kind
  TriggerBackfill routes fundamentals by data_kind, not by bar timeframe, and leaves OHLCV callers unchanged.

  @AC-6 @FR-4 @feature-198
  Scenario: Fundamentals backfill is a distinct data kind, not a timeframe
    Given the OHLCV backfill path is restricted to timeframe "1d"
    When a fundamentals backfill is triggered via TriggerBackfill with data_kind "FUNDAMENTALS"
    Then the job is accepted without supplying any bar timeframe
    And an existing OHLCV backfill request that omits data_kind still defaults to "BARS" and behaves unchanged
