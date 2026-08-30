Feature: snapshot-offline-positions
  As an operator ingesting a brokerage statement into an OFFLINE account, I want to record an
  effective-dated position snapshot as an opening baseline, so that the position projection folds
  from that baseline plus only the confirmed fills dated after the snapshot's as_of.

  @AC-1 @FR-1 @FR-2 @FR-7
  Scenario: Snapshot seeds the baseline holdings for an offline account
    Given an OFFLINE account "acc-1" with no recorded orders
    When snapshot_positions is called with as_of "2026-07-31T23:59:59Z", client_snapshot_id "11111111-1111-5111-8111-111111111111", and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},{"symbol":"LYFT","qty":-378,"avg_cost_per_share":12.50}]
    Then list_positions for "acc-1" returns AAPL qty 100 at avg_entry_price 150.00 and LYFT qty -378 at avg_entry_price 12.50
    And both AAPL and LYFT report source BASELINE with as_of "2026-07-31T23:59:59Z"

  @AC-2 @FR-4 @FR-7
  Scenario: Post-T0 confirmed buy applies on top of the baseline without double-counting
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a BUY of 50 AAPL at filled_avg_price 160.00 with filled_at "2026-08-05T14:30:00Z"
    Then list_positions for "acc-1" returns AAPL qty 150 at avg_entry_price 153.33
    And the AAPL position reports source MIXED with as_of "2026-07-31T23:59:59Z"

  @AC-3 @FR-4
  Scenario: A confirmation dated at or before T0 is subsumed by the baseline and ignored
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a BUY of 40 AAPL at filled_avg_price 145.00 with filled_at "2026-07-20T10:00:00Z"
    Then list_positions for "acc-1" returns AAPL qty 100 at avg_entry_price 150.00

  @AC-4 @FR-4 @FR-7
  Scenario: A post-T0 sell drawing down baseline shares realizes P&L against the baseline basis
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a SELL of 30 AAPL at filled_avg_price 170.00 with filled_at "2026-08-10T15:00:00Z"
    Then list_positions for "acc-1" returns AAPL qty 70 at avg_entry_price 150.00
    And the account realized P&L is 600.00
    And the AAPL position reports source MIXED with as_of "2026-07-31T23:59:59Z"

  @AC-5 @FR-3 @FR-7
  Scenario: A later-dated snapshot supersedes the earlier baseline for the projection
    Given account "acc-1" has a baseline with as_of "2026-07-31T23:59:59Z" holding AAPL qty 100 @ 150.00
    When snapshot_positions is called with as_of "2026-08-31T23:59:59Z", a new client_snapshot_id, and positions_json [{"symbol":"AAPL","qty":80,"avg_cost_per_share":155.00}]
    Then list_positions for "acc-1" returns AAPL qty 80 at avg_entry_price 155.00
    And the AAPL position reports source BASELINE with as_of "2026-08-31T23:59:59Z"

  @AC-6 @FR-3
  Scenario: Re-submitting the same client_snapshot_id replaces that snapshot's rows, never stacks
    Given account "acc-1" has a baseline created with client_snapshot_id "22222222-2222-5222-8222-222222222222" holding AAPL qty 100 @ 150.00
    When snapshot_positions is called again with the same client_snapshot_id "22222222-2222-5222-8222-222222222222" and positions_json [{"symbol":"AAPL","qty":120,"avg_cost_per_share":151.00}]
    Then list_positions for "acc-1" returns a single AAPL position with qty 120 at avg_entry_price 151.00

  @AC-7 @FR-5
  Scenario: One malformed baseline row is rejected while the valid rows commit
    Given an OFFLINE account "acc-1"
    When snapshot_positions is called with positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},{"symbol":"MSFT","qty":50,"avg_cost_per_share":-10.00}]
    Then the response commits the AAPL baseline row
    And the response rejected list contains one entry for row_index 1 with a reason naming the negative avg_cost_per_share
    And list_positions for "acc-1" returns AAPL and does not return MSFT

  @AC-8 @FR-5
  Scenario: A zero-qty baseline row flattens that symbol
    Given account "acc-1" holds a baseline TSLA qty 20 @ 200.00
    When snapshot_positions is called with a later as_of and positions_json [{"symbol":"TSLA","qty":0,"avg_cost_per_share":0}]
    Then list_positions for "acc-1" does not return a TSLA position

  @AC-9 @FR-2
  Scenario: Snapshot on a broker/paper account is rejected
    Given a broker (non-OFFLINE) account "brk-1"
    When snapshot_positions is called for "brk-1"
    Then the call is rejected with a FailedPrecondition error naming that snapshots apply to OFFLINE accounts only

  @AC-10 @FR-6
  Scenario: A snapshot write emits an append-only audit ledger event
    Given an OFFLINE account "acc-1"
    When snapshot_positions is called with client_snapshot_id "33333333-3333-5333-8333-333333333333" and as_of "2026-07-31T23:59:59Z"
    Then a ledger event of type "account.positions.baseline_set" is appended on stream key "account:acc-1" carrying account_id, user_id, client_snapshot_id "33333333-3333-5333-8333-333333333333", and as_of

  @AC-11 @FR-7
  Scenario: list_positions reports provenance so a baseline-seeded position is distinguishable
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 and an orders-only position NVDA qty 10 confirmed after T0
    When list_positions for "acc-1" is read
    Then the AAPL position reports source BASELINE with the snapshot as_of
    And the NVDA position reports source ORDERS

  @AC-12 @FR-7
  Scenario: Provenance is consistent across every portfolio read path
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00
    When the AAPL position is read through ListPositions and again through the portfolio-card path (buildAccountPortfolio/ListPortfolios)
    Then both read paths report the same source BASELINE and the same as_of for AAPL

  @AC-13 @FR-4 @FR-7
  Scenario: A symbol with baseline shares and a post-T0 fill reports MIXED provenance
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a BUY of 50 AAPL at filled_avg_price 160.00 with filled_at "2026-08-05T14:30:00Z"
    Then list_positions for "acc-1" returns AAPL qty 150 at avg_entry_price 153.33
    And the AAPL position reports source MIXED with as_of "2026-07-31T23:59:59Z"

  @AC-14 @FR-3 @FR-4
  Scenario: A later full-close snapshot reseats account realized P&L from 600.00 to 0.00
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    And an offline SELL of 30 AAPL at filled_avg_price 170.00 with filled_at "2026-08-10T15:00:00Z" has set the account realized P&L to 600.00
    When snapshot_positions is called with a later as_of "2026-08-31T23:59:59Z", a new client_snapshot_id, and positions_json [{"symbol":"AAPL","qty":70,"avg_cost_per_share":150.00}]
    Then the account realized P&L transitions from 600.00 to 0.00
    And list_positions for "acc-1" returns AAPL qty 70 at avg_entry_price 150.00 with source BASELINE

  @AC-15 @FR-5
  Scenario: An unfilled zero-qty baseline row commits as a flatten and emits no phantom position
    Given an OFFLINE account "acc-1" with no recorded orders
    When snapshot_positions is called with as_of "2026-07-31T23:59:59Z", a new client_snapshot_id, and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},{"symbol":"TSLA","qty":0,"avg_cost_per_share":0}]
    Then the response commits both the AAPL and TSLA baseline rows
    And the response rejected list is empty
    And list_positions for "acc-1" returns AAPL with source BASELINE
    And list_positions for "acc-1" does not return a TSLA position with any source

  @AC-16 @FR-5
  Scenario: A snapshot submitted while an unconfirmed NEW offline order exists warns without rejecting
    Given an OFFLINE account "acc-1" with an unconfirmed NEW offline order for MSFT
    When snapshot_positions is called with as_of "2026-07-31T23:59:59Z" and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00}]
    Then the response commits the AAPL baseline row
    And the response rejected list is empty
    And the response warnings list contains one entry naming the unconfirmed NEW MSFT order for the account
    And the MSFT NEW order is excluded from the fold

  @AC-17 @FR-4 @FR-7
  Scenario: A flatten-then-refill symbol reports MIXED even though no baseline shares survive
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a SELL of 100 AAPL at filled_avg_price 165.00 with filled_at "2026-08-03T14:00:00Z"
    And an offline order is recorded and confirmed as a BUY of 30 AAPL at filled_avg_price 170.00 with filled_at "2026-08-06T14:00:00Z"
    Then list_positions for "acc-1" returns AAPL qty 30 at avg_entry_price 170.00
    And the AAPL position reports source MIXED with as_of "2026-07-31T23:59:59Z"

  @AC-18 @FR-8
  Scenario: Deregistering an offline account purges its baseline rows
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When the OFFLINE account "acc-1" is deregistered
    Then no offline_position_baselines rows remain for account "acc-1"
    And the deregistration also purges the account's positions and realized P&L
