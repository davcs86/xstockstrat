Feature: fix-portfolio-snapshot-surface (bug fix)
  Regression guard for docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md:
  StreamPortfolioUpdates fans every user's snapshot to every subscriber (D-24), and the periodic
  snapshot writer behind portfolio.snapshot.interval_minutes is never started (D-12).
  AC-4 and AC-5 are the two FR-4 branches; /sdd-design keeps exactly one and deletes the other.

  @AC-1 @FR-1 @regression
  Scenario: A snapshot stream subscriber receives only its own snapshots
    Given a gRPC StreamPortfolioUpdates stream "A" opened with x-user-id "u-1"
    And a gRPC StreamPortfolioUpdates stream "B" opened with x-user-id "u-2"
    When portfolio processes an "order.filled" event for user "u-1" buying 10 "AAPL" @ 100.00 and the position is priced
    Then stream "A" receives a snapshot with portfolio_id "u-1"
    And stream "B" receives no snapshot

  @AC-2 @FR-2 @regression
  Scenario: A snapshot stream with no caller identity is rejected on the gRPC path
    When a gRPC StreamPortfolioUpdates stream is opened with no x-user-id
    Then the stream fails with INVALID_ARGUMENT
    And it is not registered as a subscriber

  @AC-3 @FR-3 @regression
  Scenario: The Connect path also isolates subscribers
    Given a Connect StreamPortfolioUpdates stream "A" opened with x-user-id "u-1"
    And a Connect StreamPortfolioUpdates stream "B" opened with x-user-id "u-2"
    When portfolio broadcasts a snapshot for user "u-1"
    Then stream "A" receives a snapshot with portfolio_id "u-1"
    And stream "B" receives no snapshot

  @AC-6 @FR-3 @regression
  Scenario: A snapshot stream with no caller identity is rejected on the Connect path
    When a Connect StreamPortfolioUpdates stream is opened with no x-user-id
    Then the stream fails with INVALID_ARGUMENT
    And it is not registered as a subscriber

  @AC-4 @FR-4 @regression
  Scenario: portfolio.snapshot.interval_minutes is honoured (FR-4 branch a)
    Given user "u-1" holds 10 "AAPL" priced at 100.00 and no fills occur
    And "portfolio.snapshot.interval_minutes" is 1
    When 3 minutes elapse on the service clock
    Then at least 2 "portfolio.snapshots" rows exist for "u-1" with equity 1000.00

  @AC-5 @FR-4 @regression
  Scenario: portfolio.snapshot.interval_minutes is retired (FR-4 branch b)
    Given all xstockstrat-config migrations have been applied
    When the config keys for service "portfolio" are listed in the "production" and "staging" environments
    Then neither listing contains "portfolio.snapshot.interval_minutes"
    And the portfolio CLAUDE.md config key table does not list "portfolio.snapshot.interval_minutes"
