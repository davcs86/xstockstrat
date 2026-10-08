# Promoted from docs/roadmap/features/198-historical-fundamentals-backtest/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-198` tag.
# Durable business rules xstockstrat-ui already guarantees; a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-ui - fundamentals backfill from the insights backfills page
  An operator can trigger and observe a fundamentals backfill from /insights.

  @AC-7 @FR-7 @feature-198
  Scenario: Operator triggers a fundamentals backfill from the insights UI
    Given an operator on the /insights backfills page
    When they select data kind "Fundamentals", a symbol universe, and a date range and submit
    Then a fundamentals backfill job is created and its status is observable via GetBackfillStatus
