# Promoted from feature 326 (fix-grpc-status-mapping) at launch, C-16. Do not hand-edit; scenarios are verbatim.
Feature: fix-grpc-status-mapping (bug fix)
  Regression guard: CreateWatchlist reports a duplicate name as ALREADY_EXISTS, and other insert failures stay INTERNAL.

  # guards: docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md
  @AC-3 @regression @feature-326
  Scenario: creating a duplicate non-system watchlist name returns ALREADY_EXISTS
    Given user U already has a non-system watchlist named "A"
    When user U calls CreateWatchlist with name "A"
    Then the call fails with gRPC status ALREADY_EXISTS, not INTERNAL

  # guards: docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md
  @AC-4 @regression @feature-326
  Scenario: a non-unique-violation insert failure still returns INTERNAL
    Given the watchlist insert fails with a database error other than SQLSTATE 23505
    When user U calls CreateWatchlist with name "B"
    Then the call fails with gRPC status INTERNAL
