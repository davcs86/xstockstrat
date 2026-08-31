# Business-rule suite: xstockstrat-trading — snapshot-offline-positions
# Promoted from docs/roadmap/features/163-snapshot-offline-positions/acceptance.feature
# by /sdd-archiver on 2026-08-31 per Constitution C-16.
# Scenarios owned by xstockstrat-trading: AC-7, AC-9, AC-10, AC-15, AC-16, AC-18
# (service-validation, offline-gate, audit-event, row-commit, warning, deregister-purge)

Feature: offline position baseline — trading service rules
  xstockstrat-trading owns SnapshotOfflinePositions: per-row validation, offline-only gate,
  confirmLock-serialized persist+recompute+emit, audit ledger event, warning on unconfirmed orders,
  and deregister baseline purge.

  @AC-7 @feature-163 @FR-5
  Scenario: One malformed baseline row is rejected while the valid rows commit
    Given an OFFLINE account "acc-1"
    When snapshot_positions is called with positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},{"symbol":"MSFT","qty":50,"avg_cost_per_share":-10.00}]
    Then the response commits the AAPL baseline row
    And the response rejected list contains one entry for row_index 1 with a reason naming the negative avg_cost_per_share
    And list_positions for "acc-1" returns AAPL and does not return MSFT

  @AC-9 @feature-163 @FR-2
  Scenario: Snapshot on a broker/paper account is rejected
    Given a broker (non-OFFLINE) account "brk-1"
    When snapshot_positions is called for "brk-1"
    Then the call is rejected with a FailedPrecondition error naming that snapshots apply to OFFLINE accounts only

  @AC-10 @feature-163 @FR-6
  Scenario: A snapshot write emits an append-only audit ledger event
    Given an OFFLINE account "acc-1"
    When snapshot_positions is called with client_snapshot_id "33333333-3333-5333-8333-333333333333" and as_of "2026-07-31T23:59:59Z"
    Then a ledger event of type "account.positions.baseline_set" is appended on stream key "account:acc-1" carrying account_id, user_id, client_snapshot_id "33333333-3333-5333-8333-333333333333", and as_of

  @AC-15 @feature-163 @FR-5
  Scenario: An unfilled zero-qty baseline row commits as a flatten and emits no phantom position
    Given an OFFLINE account "acc-1" with no recorded orders
    When snapshot_positions is called with as_of "2026-07-31T23:59:59Z", a new client_snapshot_id, and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},{"symbol":"TSLA","qty":0,"avg_cost_per_share":0}]
    Then the response commits both the AAPL and TSLA baseline rows
    And the response rejected list is empty
    And list_positions for "acc-1" returns AAPL with source BASELINE
    And list_positions for "acc-1" does not return a TSLA position with any source

  @AC-16 @feature-163 @FR-5
  Scenario: A snapshot submitted while an unconfirmed NEW offline order exists warns without rejecting
    Given an OFFLINE account "acc-1" with an unconfirmed NEW offline order for MSFT
    When snapshot_positions is called with as_of "2026-07-31T23:59:59Z" and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00}]
    Then the response commits the AAPL baseline row
    And the response rejected list is empty
    And the response warnings list contains one entry naming the unconfirmed NEW MSFT order for the account
    And the MSFT NEW order is excluded from the fold

  @AC-18 @feature-163 @FR-8
  Scenario: Deregistering an offline account purges its baseline rows
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When the OFFLINE account "acc-1" is deregistered
    Then no offline_position_baselines rows remain for account "acc-1"
    And the deregistration also purges the account's positions and realized P&L
