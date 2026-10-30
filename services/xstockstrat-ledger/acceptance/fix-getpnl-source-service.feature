# Promoted from docs/roadmap/features/251-fix-getpnl-source-service/acceptance.feature on launch (C-16). Scenarios are verbatim; each carries its source @AC-* and a @feature-251 tag. A rule enters only by promotion.
Feature: xstockstrat-ledger - QueryEvents pages each event exactly once and rejects bad cursors

  @AC-12 @FR-5 @regression @feature-251
  Scenario: The ledger pages QueryEvents exactly once per event, including recorded_at ties
    Given a TimescaleDB ledger holding 7 events with one recorded_at and one source_service
    When a client drains QueryEvents filtered by that source_service with page size 3, following next_page_token
    Then it receives at least 2 pages
    And it receives every event_id exactly once, ordered by sequence

  @AC-13 @FR-5 @regression @feature-251
  Scenario: A malformed page_token is rejected
    Given a QueryEvents request whose page_token does not decode to a ledger cursor
    When the ledger serves QueryEvents
    Then it returns INVALID_ARGUMENT
