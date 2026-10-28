Feature: fix-analysis-owner-scope (bug fix)
  Regression guard for docs/reports/2026-10-21-analysis-owner-scope-defect.md:
  the analysis entry-backfill reads trading orders with no owner, dies on one bad owner; strategies.update is owner-agnostic.

  @AC-1 @FR-1 @regression
  Scenario: The entry-backfill asks trading only for the strategy owner's orders
    Given live strategy "s-1" owned by "u-a" whose universe includes "AAPL"
    When the boot entry-backfill runs
    Then the ListOrders request for ("s-1", "AAPL") carries user_id "u-a"
    And it is sent with metadata x-user-id "u-a"

  @AC-2 @FR-2 @regression
  Scenario: Another owner's fills never seed an owner's entry state
    Given live strategy "s-1" owned by "u-a" whose universe includes "AAPL"
    And trading holds a filled BUY 10 "AAPL" on strategy "s-1" for user "u-b" and no orders for user "u-a"
    And the trading stub filters ListOrders by the request user_id
    When the boot entry-backfill runs
    Then the live loop has no entry time for ("u-a", "s-1", "AAPL")
    And the live loop's last state for ("u-a", "s-1", "AAPL") is not True
    And no entry cooldown is written for ("u-a", "s-1", "AAPL")

  @AC-3 @FR-3 @regression
  Scenario: One owner whose drains fail does not stop the backfill for other owners
    Given live strategy "s-sys" owned by "system" and live strategy "s-2" owned by "u-a" whose universe includes "MSFT"
    And trading holds a filled BUY 5 "MSFT" on strategy "s-2" for user "u-a" at 2026-10-01T14:30:00Z
    When the boot entry-backfill runs
    Then it completes without raising
    And the live loop's entry time for ("u-a", "s-2", "MSFT") is 2026-10-01T14:30:00Z
    And a warning naming strategy "s-sys" and owner "system" is logged

  @AC-8 @FR-3 @regression
  Scenario: A non-ValueError drain failure for one owner does not stop the backfill for other owners
    Given live strategy "s-3" owned by "u-b" whose held-symbols drain raises a portfolio RPC error
    And live strategy "s-2" owned by "u-a" whose universe includes "MSFT"
    And trading holds a filled BUY 5 "MSFT" on strategy "s-2" for user "u-a" at 2026-10-01T14:30:00Z
    When the boot entry-backfill runs
    Then it completes without raising
    And the live loop's entry time for ("u-a", "s-2", "MSFT") is 2026-10-01T14:30:00Z
    And a warning naming strategy "s-3" and owner "u-b" is logged

  @AC-4 @FR-4 @regression
  Scenario: A failed live-strategies read ends the backfill quietly
    Given the analysis database raises on the live-strategies query
    When the boot entry-backfill runs
    Then it completes without raising
    And a warning naming the failed live-strategies read is logged
    And no ListOrders request is sent

  @AC-5 @FR-4 @regression
  Scenario: A failed system-signal drain does not stop the backfill
    Given live strategy "s-2" owned by "u-a" whose universe includes "MSFT"
    And trading holds a filled BUY 5 "MSFT" on strategy "s-2" for user "u-a" at 2026-10-01T14:30:00Z
    And the system-signal drain raises
    When the boot entry-backfill runs
    Then it completes without raising
    And the live loop's entry time for ("u-a", "s-2", "MSFT") is 2026-10-01T14:30:00Z
    And a warning naming the failed system-signal drain is logged

  @AC-6 @FR-5 @regression
  Scenario: The strategies repository offers no owner-agnostic read or write
    Given the analysis StrategiesRepository
    Then it has no method named "get_by_id"
    And it has no method named "update"

  @AC-7 @FR-6 @regression
  Scenario: Servicer tests mock only repository methods the servicer calls
    Given the analysis test suite under services/xstockstrat-analysis/tests
    Then no test references "_strategies_repo.get_by_id" or "_strategies_repo.update("
    And the analysis test suite passes

  @AC-9 @FR-4 @regression
  Scenario: A failed blend-universe resolve skips only the blend pairs
    Given the fundamentals blend is enabled and the blend strategy is live
    And live strategy "s-2" owned by "u-a" whose universe includes "MSFT"
    And trading holds a filled BUY 5 "MSFT" on strategy "s-2" for user "u-a" at 2026-10-01T14:30:00Z
    And the fundamentals-universe resolve raises
    When the boot entry-backfill runs
    Then it completes without raising
    And the live loop's entry time for ("u-a", "s-2", "MSFT") is 2026-10-01T14:30:00Z
    And no ListOrders request is sent for the blend strategy
    And a warning naming the failed fundamentals-universe resolve is logged
