# Promoted from docs/roadmap/features/163-snapshot-offline-positions/acceptance.feature
# Source: @AC-6, @AC-7, @AC-8, @AC-9, @AC-15, @AC-16 — trading service scenarios
Feature: snapshot-offline-positions (trading)
  Acceptance scenarios for the xstockstrat-trading service promoted from feature 163.
  Covers SnapshotOfflinePositions RPC semantics: idempotent re-submission, partial-reject,
  zero-qty flatten, broker-account rejection, and unconfirmed-order warning.

  @AC-6 @FR-3 @feature-163
  Scenario: Re-submitting the same client_snapshot_id replaces that snapshot's rows, never stacks
    Given account "acc-1" has a baseline created with client_snapshot_id "22222222-2222-5222-8222-222222222222" holding AAPL qty 100 @ 150.00
    When snapshot_positions is called again with the same client_snapshot_id "22222222-2222-5222-8222-222222222222" and positions_json [{"symbol":"AAPL","qty":120,"avg_cost_per_share":151.00}]
    Then list_positions for "acc-1" returns a single AAPL position with qty 120 at avg_entry_price 151.00

  @AC-7 @FR-5 @feature-163
  Scenario: One malformed baseline row is rejected while the valid rows commit
    Given an OFFLINE account "acc-1"
    When snapshot_positions is called with positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},{"symbol":"MSFT","qty":50,"avg_cost_per_share":-10.00}]
    Then the response commits the AAPL baseline row
    And the response rejected list contains one entry for row_index 1 with a reason naming the negative avg_cost_per_share
    And list_positions for "acc-1" returns AAPL and does not return MSFT

  @AC-8 @FR-5 @feature-163
  Scenario: A zero-qty baseline row flattens that symbol
    Given account "acc-1" holds a baseline TSLA qty 20 @ 200.00
    When snapshot_positions is called with a later as_of and positions_json [{"symbol":"TSLA","qty":0,"avg_cost_per_share":0}]
    Then list_positions for "acc-1" does not return a TSLA position

  @AC-9 @FR-2 @feature-163
  Scenario: Snapshot on a broker/paper account is rejected
    Given a broker (non-OFFLINE) account "brk-1"
    When snapshot_positions is called for "brk-1"
    Then the call is rejected with a FailedPrecondition error naming that snapshots apply to OFFLINE accounts only

  @AC-15 @FR-5 @feature-163
  Scenario: An unfilled zero-qty baseline row commits as a flatten and emits no phantom position
    Given an OFFLINE account "acc-1" with no recorded orders
    When snapshot_positions is called with as_of "2026-07-31T23:59:59Z", a new client_snapshot_id, and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},{"symbol":"TSLA","qty":0,"avg_cost_per_share":0}]
    Then the response commits both the AAPL and TSLA baseline rows
    And the response rejected list is empty
    And list_positions for "acc-1" returns AAPL with source BASELINE
    And list_positions for "acc-1" does not return a TSLA position with any source

  @AC-16 @FR-5 @feature-163
  Scenario: A snapshot submitted while an unconfirmed NEW offline order exists warns without rejecting
    Given an OFFLINE account "acc-1" with an unconfirmed NEW offline order for MSFT
    When snapshot_positions is called with as_of "2026-07-31T23:59:59Z" and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00}]
    Then the response commits the AAPL baseline row
    And the response rejected list is empty
    And the response warnings list contains one entry naming the unconfirmed NEW MSFT order for the account
    And the MSFT NEW order is excluded from the fold
