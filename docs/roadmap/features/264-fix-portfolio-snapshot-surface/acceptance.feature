Feature: fix-portfolio-snapshot-surface (bug fix)
  Regression guard for docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md:
  StreamPortfolioUpdates fans every user's snapshot to every subscriber (D-24), and the periodic
  snapshot writer behind portfolio.snapshot.interval_minutes is never started (D-12).
  FR-4 takes branch (b), retire the key; the branch (a) scenario @AC-4 was deleted at design (operator, 2026-10-22).

  @AC-1 @FR-1 @regression
  Scenario: A snapshot stream subscriber receives only its own snapshots
    Given a gRPC StreamPortfolioUpdates stream "A" opened with x-user-id "u-1"
    And a gRPC StreamPortfolioUpdates stream "B" opened with x-user-id "u-2"
    When a snapshot is broadcast for user "u-1" holding 10 "AAPL" priced at 100.00
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

  # Non-regression guard: Connect already rejects an empty caller, so this passes on the buggy code.
  @AC-6 @FR-3 @non-regression
  Scenario: A snapshot stream with no caller identity stays rejected on the Connect path
    When a Connect StreamPortfolioUpdates stream is opened with no x-user-id
    Then the stream fails with INVALID_ARGUMENT
    And it is not registered as a subscriber

  @AC-5 @FR-4 @regression
  Scenario: portfolio.snapshot.interval_minutes is retired (FR-4 branch b)
    Given the xstockstrat-config migration set
    When the up migrations are scanned in numeric order for "portfolio.snapshot.interval_minutes" and "snapshot.interval_minutes"
    Then the highest-numbered match deletes the key from config.config_values in namespace "portfolio"
    And no migration from that one onward inserts either key form
    And after the migrations are applied, neither the "production" nor the "staging" listing for service "portfolio" contains "portfolio.snapshot.interval_minutes"
