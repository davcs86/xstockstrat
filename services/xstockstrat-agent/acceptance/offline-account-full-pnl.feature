# Promoted from docs/roadmap/features/240-offline-account-full-pnl/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-240` tag.
# Durable business rules xstockstrat-agent already guarantees - a rule enters only by promotion from
# a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-agent - offline account fees and P&L fields over MCP
  The MCP offline-account and position tools accept cumulative fees on confirm and return fees and the
  new position fields, including zero-valued ones.

  @AC-17 @FR-6 @FR-3 @feature-240
  Scenario: The agent can confirm an offline order with fees and read the new fields
    Given an offline order "ord-3" for 10 MSFT with status NEW in "acc-1"
    When the agent calls manage_offline_account with operation "confirm_order", order_id "ord-3", filled_qty 10, filled_avg_price 100.00, and fees 1.25
    Then manage_offline_account get_order for "ord-3" returns fees 1.25
    And get_positions_by_account_id for "acc-1" returns MSFT with fields day_pnl, day_pnl_pct, unrealized_pnl_pct, mark_source, and mark_as_of

  @AC-33 @FR-6 @FR-3 @feature-240
  Scenario: Agent list tools return fees and the new position fields
    Given offline order "ord-3" for 10 MSFT in "acc-1" was confirmed at filled_avg_price 100.00 with fees 1.25
    When the agent calls manage_offline_account with operation "list_orders" for "acc-1"
    And the agent calls manage_offline_account with operation "list_positions" for "acc-1"
    And the agent calls get_positions
    Then the "ord-3" entry from list_orders has fees 1.25
    And the MSFT entry from list_positions and from get_positions each has fields day_pnl, day_pnl_pct, unrealized_pnl_pct, mark_source, and mark_as_of
