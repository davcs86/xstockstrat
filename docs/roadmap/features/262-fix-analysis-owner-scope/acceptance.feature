Feature: fix-analysis-owner-scope (bug fix)
  Regression guard for docs/reports/2026-10-21-analysis-owner-scope-defect.md:
  the analysis entry-backfill reads trading orders with no owner, dies on one bad owner; strategies.update is owner-agnostic.

  @AC-1 @regression
  Scenario: The entry-backfill asks trading only for the strategy owner's orders
    Given live strategy "s-1" owned by "u-a" whose universe includes "AAPL"
    When the boot entry-backfill runs
    Then the ListOrders request for ("s-1", "AAPL") carries user_id "u-a"
    And it is sent with metadata x-user-id "u-a"

  @AC-2 @regression
  Scenario: Another owner's fills never seed an owner's entry state
    Given live strategy "s-1" owned by "u-a" whose universe includes "AAPL"
    And trading holds a filled BUY 10 "AAPL" on strategy "s-1" for user "u-b" and no orders for user "u-a"
    And the trading stub filters ListOrders by the request user_id
    When the boot entry-backfill runs
    Then the live loop has no entry time for ("u-a", "s-1", "AAPL")
    And the live loop's last state for ("u-a", "s-1", "AAPL") is not True

  @AC-3 @regression
  Scenario: One owner whose drains fail does not stop the backfill for other owners
    Given a live strategy owned by "system" and live strategy "s-2" owned by "u-a" whose universe includes "MSFT"
    And trading holds a filled BUY 5 "MSFT" on strategy "s-2" for user "u-a" at 2026-10-01T14:30:00Z
    When the boot entry-backfill runs
    Then it completes without raising
    And the live loop's entry time for ("u-a", "s-2", "MSFT") is 2026-10-01T14:30:00Z
    And a warning naming the skipped "system" strategy is logged

  @AC-4 @regression
  Scenario: The strategies repository exposes no owner-agnostic update
    Given strategies "s-1" owned by "u-a" and "s-1" owned by "u-b"
    When any strategies repository write targets strategy "s-1" for owner "u-a"
    Then only the row owned by "u-a" is changed
    And the row owned by "u-b" keeps its display_name and definition_json
