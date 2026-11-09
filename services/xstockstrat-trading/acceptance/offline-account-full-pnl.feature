# Promoted from docs/roadmap/features/240-offline-account-full-pnl/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-240` tag.
# Durable business rules xstockstrat-trading already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-trading - offline account fees, snapshot carry and confirm semantics
  Confirmed offline fills carry cumulative fees that never change cost basis, snapshots carry lifetime
  realized forward, and un-confirm/re-confirm preserve fees and filled_at.

  @AC-7 @FR-3 @feature-240
  Scenario: A buy fee is recorded as a separate line and does not change cost basis
    Given "acc-1" holds no positions
    When an offline BUY of 100 AAPL at filled_avg_price 150.00 is confirmed with fees 1.50
    Then list_positions for "acc-1" returns AAPL avg_entry_price 150.00 and cost_basis 15000.00
    And the account fees_since_snapshot is 1.50

  @AC-8 @FR-3 @feature-240
  Scenario: Re-confirming an order replaces its fees
    Given an offline order "ord-1" in "acc-1" was confirmed with fees 5.00
    When "ord-1" is re-confirmed with the same fill and fees 2.00
    Then the account fees_since_snapshot is 2.00
    And get_order for "ord-1" returns fees 2.00

  @AC-9 @FR-3 @feature-240
  Scenario: Negative fees are rejected
    Given an offline order "ord-2" with status NEW
    When confirm_order is called for "ord-2" with filled_qty 10, filled_avg_price 100.00, and fees -1.00
    Then the call fails with INVALID_ARGUMENT and message containing "fees must be >= 0"
    And "ord-2" remains status NEW

  @AC-10 @FR-4 @feature-240
  Scenario: A snapshot resets since-snapshot realized but carries lifetime realized forward
    Given the read happens on "2026-12-01"
    And "acc-1" has since-snapshot realized 600.00, fees_since_snapshot 3.00, lifetime realized 600.00, and fees_lifetime 3.00
    And all of its fills have filled_at on or before "2026-10-31T23:59:59Z"
    When snapshot_positions is called with as_of "2026-10-31T23:59:59Z" and positions_json [{"symbol":"AAPL","qty":70,"avg_cost_per_share":150.00}]
    Then the account realized P&L since snapshot is 0.00 and fees_since_snapshot is 0.00
    And the account lifetime realized P&L is 600.00
    And the account fees_lifetime is 3.00

  @AC-11 @FR-4 @feature-240
  Scenario: Lifetime realized accumulates across two snapshots
    Given the read happens on "2026-12-01"
    And "acc-1" holds AAPL qty 70 @ avg 150.00 from a snapshot with as_of "2026-10-31T23:59:59Z"
    And "acc-1" has lifetime realized 600.00 carried from that snapshot and since-snapshot realized 0.00
    And an offline SELL of 20 AAPL at filled_avg_price 155.00 with filled_at "2026-11-03T15:00:00Z" is confirmed
    When snapshot_positions is called with as_of "2026-11-30T23:59:59Z" and positions_json [{"symbol":"AAPL","qty":50,"avg_cost_per_share":150.00}]
    Then the account lifetime realized P&L is 700.00
    And the account realized P&L since snapshot is 0.00

  @AC-20 @FR-3 @feature-240
  Scenario: A sell fee yields realized P&L gross and net of fees
    Given "acc-1" holds AAPL qty 100 @ avg 150.00 bought with fees 1.50 in the current snapshot window
    When an offline SELL of 100 AAPL at filled_avg_price 156.00 is confirmed with fees 1.50
    Then the account realized P&L since snapshot is 600.00
    And the account fees_since_snapshot is 3.00
    And the PortfolioPanel for "acc-1" shows "Realized (since snapshot)" 600.00 with net 597.00

  @AC-21 @FR-3 @feature-240
  Scenario: Fees on a partial confirm are the order's cumulative total
    Given an offline order "ord-4" for 100 AAPL with status NEW in "acc-1"
    When "ord-4" is confirmed with filled_qty 40, filled_avg_price 150.00, and fees 0.40
    And "ord-4" is re-confirmed with filled_qty 100, filled_avg_price 150.00, and fees 1.00
    Then "ord-4" has status FILLED and fees 1.00
    And the account fees_since_snapshot is 1.00

  @AC-37 @FR-3 @feature-240
  Scenario: A re-confirm that omits fees keeps the recorded fees
    Given an offline order "ord-5" for 10 AAPL in "acc-1" was confirmed at filled_avg_price 150.00 with fees 2.00
    When "ord-5" is re-confirmed with filled_qty 10, filled_avg_price 151.00, and no fees value
    Then get_order for "ord-5" returns filled_avg_price 151.00 and fees 2.00
    And the account fees_since_snapshot is 2.00

  @AC-41 @FR-4 @feature-240
  Scenario: A snapshot carries the realized P&L earned before its as_of into lifetime realized
    Given the read date is 2026-12-01 and "acc-1" has no snapshot baseline
    And an offline BUY of 100 AAPL at filled_avg_price 150.00 with filled_at "2026-10-01T15:00:00Z" is confirmed
    And an offline SELL of 40 AAPL at filled_avg_price 165.00 with filled_at "2026-10-20T15:00:00Z" is confirmed
    And an offline SELL of 20 AAPL at filled_avg_price 155.00 with filled_at "2026-11-05T15:00:00Z" is confirmed
    When the trader records snapshot "S1" for "acc-1" with as_of "2026-10-31T23:59:59Z" and positions [AAPL qty 60 avg_cost_per_share 150.00]
    And the trader reads the portfolio for "acc-1"
    Then realized_pnl is 100.00
    And realized_pnl_lifetime is 700.00
    And the AAPL position qty is 40

  @AC-42 @FR-4 @feature-240
  Scenario: An empty statement records a full flatten and keeps the carry
    Given an offline BUY of 100 AAPL at filled_avg_price 150.00 with filled_at "2026-10-01T15:00:00Z" is confirmed on "acc-1"
    And an offline SELL of 100 AAPL at filled_avg_price 156.00 with filled_at "2026-10-20T15:00:00Z" is confirmed
    When the trader records a snapshot for "acc-1" with as_of "2026-10-31T23:59:59Z" and positions_json "[]"
    And the trader reads the portfolio for "acc-1"
    Then "acc-1" has no positions
    And realized_pnl is 0.00
    And realized_pnl_lifetime is 600.00

  @AC-48 @FR-3 @feature-240
  Scenario: Un-confirm hides fees and filled_at; a bare re-confirm restores them
    Given offline order "ord-7" on "acc-1" for qty 10 is confirmed with filled_qty 10, filled_avg_price 150.00, filled_at "2026-10-19T14:00:00Z" and fees 2.00
    When the trader confirms "ord-7" with filled_qty 0
    Then the response shows status NEW with no fees value and no filled_at value
    And get_order for "ord-7" shows status NEW with no fees value and no filled_at value
    When the trader confirms "ord-7" with filled_qty 10 and filled_avg_price 150.00, with no fees and no filled_at
    Then the response shows status FILLED, fees 2.00 and filled_at "2026-10-19T14:00:00Z"

  Rule: Snapshot carry and frozen-window edits on the S1 history

    Background:
      Given the read date is 2026-12-01
      And "acc-1" has confirmed offline orders "ord-b1" BUY 100 AAPL at 150.00 filled_at "2026-10-01T15:00:00Z", "ord-s1" SELL 40 AAPL at 165.00 filled_at "2026-10-20T15:00:00Z" and "ord-s2" SELL 20 AAPL at 155.00 filled_at "2026-11-05T15:00:00Z", none with fees
      And "acc-1" has snapshot "S1" (as_of "2026-10-31T23:59:59Z", AAPL qty 60 @ 150.00)

    @AC-43 @FR-4 @feature-240
    Scenario: A snapshot whose rows are all rejected changes nothing
      When the trader records snapshot "S2" for "acc-1" with as_of "2026-11-30T23:59:59Z" and positions_json '[{"symbol":"","qty":10,"avg_cost_per_share":1}]'
      Then the response has committed_count 0 and 1 rejected row
      And the AAPL position qty is 40
      And realized_pnl is 100.00
      And realized_pnl_lifetime is 700.00

    @AC-44 @FR-4 @feature-240
    Scenario: Changing the as_of of a snapshot that is not the latest is rejected
      Given "acc-1" has snapshot "S2" (as_of "2026-11-30T23:59:59Z", AAPL qty 40 @ 150.00)
      When the trader re-submits snapshot "S1" for "acc-1" with as_of "2026-11-15T23:59:59Z" and positions [AAPL qty 60 avg_cost_per_share 150.00]
      Then the call fails with FAILED_PRECONDITION
      And realized_pnl_lifetime is 700.00
      And realized_pnl is 0.00
      And the AAPL position qty is 40

    @AC-45 @FR-4 @feature-240
    Scenario: Moving the latest snapshot's as_of forward recomputes its carry without counting itself
      When the trader re-submits snapshot "S1" with as_of "2026-11-10T23:59:59Z" and positions [AAPL qty 40 avg_cost_per_share 140.00]
      And the trader reads the portfolio for "acc-1"
      Then the AAPL position qty is 40 and avg_cost_per_share is 140.00
      And realized_pnl is 0.00
      And realized_pnl_lifetime is 700.00

    @AC-46 @FR-4 @feature-240
    Scenario: A confirm whose fill is inside the frozen window is accepted and ignored (preserves feature 163 rule AC-3)
      Given a NEW offline BUY of 10 AAPL exists on "acc-1"
      When the trader confirms it with filled_qty 10, filled_avg_price 150.00, filled_at "2026-10-15T15:00:00Z" and fees 5.00
      Then the confirm succeeds
      And the AAPL position qty is 40
      And realized_pnl is 100.00 and realized_pnl_lifetime is 700.00
      And fees_since_snapshot is 0.00 and fees_lifetime is 0.00

    @AC-47 @FR-3 @feature-240
    Scenario: Re-confirming without filled_at keeps a frozen order frozen
      When the trader re-confirms "ord-s1" with filled_qty 40, filled_avg_price 165.00, fees 2.00 and no filled_at
      Then get_order for "ord-s1" shows filled_at "2026-10-20T15:00:00Z"
      And the AAPL position qty is 40
      And realized_pnl is 100.00 and realized_pnl_lifetime is 700.00
      And fees_lifetime is 0.00
