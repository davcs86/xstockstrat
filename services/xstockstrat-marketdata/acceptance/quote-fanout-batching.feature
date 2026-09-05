# Promoted from docs/roadmap/features/178-quote-fanout-batching/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-178` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata — cold-symbol single-flight coalescing
  Regression guard: concurrent first-requests for an unbackfilled symbol collapse into a single
  upstream Alpaca fetch (single-flight), preventing a thundering herd on the cold-symbol fallback.

  @AC-3 @FR-3 @feature-178
  Scenario: Concurrent cold-symbol requests coalesce to one Alpaca fetch
    Given symbol ZZZZ has never been backfilled and is absent from cache
    When 5 requests for ZZZZ latest data arrive simultaneously
    Then exactly one upstream Alpaca fetch is issued for ZZZZ
    And all 5 requests receive that fetch's result
