# Promoted from docs/roadmap/features/264-fix-portfolio-snapshot-surface/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-264` tag.
# Durable business rules xstockstrat-portfolio already guarantees. A rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-portfolio - StreamPortfolioUpdates is owner-scoped and fail-closed
  A snapshot stream delivers only the subscriber's own snapshots (a snapshot's portfolio_id is the owning
  user_id) and rejects a subscriber with no caller identity.

  @AC-1 @FR-1 @regression @feature-264
  Scenario: A snapshot stream subscriber receives only its own snapshots
    Given a gRPC StreamPortfolioUpdates stream "A" opened with x-user-id "u-1"
    And a gRPC StreamPortfolioUpdates stream "B" opened with x-user-id "u-2"
    When a snapshot is broadcast for user "u-1" holding 10 "AAPL" priced at 100.00
    Then stream "A" receives a snapshot with portfolio_id "u-1"
    And stream "B" receives no snapshot

  @AC-2 @FR-2 @regression @feature-264
  Scenario: A snapshot stream with no caller identity is rejected on the gRPC path
    When a gRPC StreamPortfolioUpdates stream is opened with no x-user-id
    Then the stream fails with INVALID_ARGUMENT
    And it is not registered as a subscriber

  @AC-3 @FR-3 @regression @feature-264
  Scenario: The Connect path also isolates subscribers
    Given a Connect StreamPortfolioUpdates stream "A" opened with x-user-id "u-1"
    And a Connect StreamPortfolioUpdates stream "B" opened with x-user-id "u-2"
    When portfolio broadcasts a snapshot for user "u-1"
    Then stream "A" receives a snapshot with portfolio_id "u-1"
    And stream "B" receives no snapshot

  @AC-6 @FR-3 @non-regression @feature-264
  Scenario: A snapshot stream with no caller identity stays rejected on the Connect path
    When a Connect StreamPortfolioUpdates stream is opened with no x-user-id
    Then the stream fails with INVALID_ARGUMENT
    And it is not registered as a subscriber
