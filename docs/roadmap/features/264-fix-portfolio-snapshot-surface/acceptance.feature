Feature: fix-portfolio-snapshot-surface (bug fix)
  Regression guard for docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md:
  StreamPortfolioUpdates fans every user's snapshot to every subscriber (D-24), and the periodic
  snapshot writer behind portfolio.snapshot.interval_minutes is never started (D-12).

  @AC-1 @regression
  Scenario: A snapshot stream subscriber receives only its own snapshots
    Given a gRPC StreamPortfolioUpdates stream "A" opened with x-user-id "u-1"
    And a gRPC StreamPortfolioUpdates stream "B" opened with x-user-id "u-2"
    When portfolio processes an "order.filled" event for user "u-1" buying 10 "AAPL" @ 100.00 and the position is priced
    Then stream "A" receives a snapshot with portfolio_id "u-1"
    And stream "B" receives no snapshot

  @AC-2 @regression
  Scenario: A snapshot stream with no caller identity is rejected on the gRPC path
    When a gRPC StreamPortfolioUpdates stream is opened with no x-user-id
    Then the stream fails with INVALID_ARGUMENT
    And it is not registered as a subscriber

  @AC-3 @regression
  Scenario: The Connect path also isolates subscribers
    Given a Connect StreamPortfolioUpdates stream opened with x-user-id "u-2"
    When portfolio broadcasts a snapshot for user "u-1"
    Then the "u-2" stream receives no snapshot

  @AC-4 @regression
  Scenario: portfolio.snapshot.interval_minutes is honoured or no longer advertised
    Given user "u-1" holds 10 "AAPL" priced at 100.00 and no fills occur
    And "portfolio.snapshot.interval_minutes" is 1
    When 3 minutes elapse on the service clock
    Then either at least 2 "portfolio.snapshots" rows exist for "u-1" with equity 1000.00
    Or the key "portfolio.snapshot.interval_minutes" is no longer seeded or documented and StartSnapshotWriter no longer exists
