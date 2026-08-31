# Business-rule suite: xstockstrat-portfolio — snapshot-offline-positions
# Promoted from docs/roadmap/features/163-snapshot-offline-positions/acceptance.feature
# by /sdd-archiver on 2026-08-31 per Constitution C-16.
# Scenarios owned by xstockstrat-portfolio: AC-1-6, AC-8, AC-11-14, AC-17
# (position projection, fold correctness, provenance, statement-sealed realized reset)

Feature: offline position baseline — portfolio projection rules
  xstockstrat-portfolio stores and surfaces the baseline-seeded position projection:
  post-T0 fill application, pre-T0 fill exclusion, sell realized P&L, snapshot supersession,
  idempotent re-submit, zero-qty flatten, and provenance on every read path.

  @AC-1 @feature-163 @FR-1 @FR-2 @FR-7
  Scenario: Snapshot seeds the baseline holdings for an offline account
    Given an OFFLINE account "acc-1" with no recorded orders
    When snapshot_positions is called with as_of "2026-07-31T23:59:59Z", client_snapshot_id "11111111-1111-5111-8111-111111111111", and positions_json [{"symbol":"AAPL","qty":100,"avg_cost_per_share":150.00},{"symbol":"LYFT","qty":-378,"avg_cost_per_share":12.50}]
    Then list_positions for "acc-1" returns AAPL qty 100 at avg_entry_price 150.00 and LYFT qty -378 at avg_entry_price 12.50
    And both AAPL and LYFT report source BASELINE with as_of "2026-07-31T23:59:59Z"

  @AC-2 @feature-163 @FR-4 @FR-7
  Scenario: Post-T0 confirmed buy applies on top of the baseline without double-counting
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a BUY of 50 AAPL at filled_avg_price 160.00 with filled_at "2026-08-05T14:30:00Z"
    Then list_positions for "acc-1" returns AAPL qty 150 at avg_entry_price 153.33
    And the AAPL position reports source MIXED with as_of "2026-07-31T23:59:59Z"

  @AC-3 @feature-163 @FR-4
  Scenario: A confirmation dated at or before T0 is subsumed by the baseline and ignored
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a BUY of 40 AAPL at filled_avg_price 145.00 with filled_at "2026-07-20T10:00:00Z"
    Then list_positions for "acc-1" returns AAPL qty 100 at avg_entry_price 150.00

  @AC-4 @feature-163 @FR-4 @FR-7
  Scenario: A post-T0 sell drawing down baseline shares realizes P&L against the baseline basis
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a SELL of 30 AAPL at filled_avg_price 170.00 with filled_at "2026-08-10T15:00:00Z"
    Then list_positions for "acc-1" returns AAPL qty 70 at avg_entry_price 150.00
    And the account realized P&L is 600.00
    And the AAPL position reports source MIXED with as_of "2026-07-31T23:59:59Z"

  @AC-5 @feature-163 @FR-3 @FR-7
  Scenario: A later-dated snapshot supersedes the earlier baseline for the projection
    Given account "acc-1" has a baseline with as_of "2026-07-31T23:59:59Z" holding AAPL qty 100 @ 150.00
    When snapshot_positions is called with as_of "2026-08-31T23:59:59Z", a new client_snapshot_id, and positions_json [{"symbol":"AAPL","qty":80,"avg_cost_per_share":155.00}]
    Then list_positions for "acc-1" returns AAPL qty 80 at avg_entry_price 155.00
    And the AAPL position reports source BASELINE with as_of "2026-08-31T23:59:59Z"

  @AC-6 @feature-163 @FR-3
  Scenario: Re-submitting the same client_snapshot_id replaces that snapshot's rows, never stacks
    Given account "acc-1" has a baseline created with client_snapshot_id "22222222-2222-5222-8222-222222222222" holding AAPL qty 100 @ 150.00
    When snapshot_positions is called again with the same client_snapshot_id "22222222-2222-5222-8222-222222222222" and positions_json [{"symbol":"AAPL","qty":120,"avg_cost_per_share":151.00}]
    Then list_positions for "acc-1" returns a single AAPL position with qty 120 at avg_entry_price 151.00

  @AC-8 @feature-163 @FR-5
  Scenario: A zero-qty baseline row flattens that symbol
    Given account "acc-1" holds a baseline TSLA qty 20 @ 200.00
    When snapshot_positions is called with a later as_of and positions_json [{"symbol":"TSLA","qty":0,"avg_cost_per_share":0}]
    Then list_positions for "acc-1" does not return a TSLA position

  @AC-11 @feature-163 @FR-7
  Scenario: list_positions reports provenance so a baseline-seeded position is distinguishable
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 and an orders-only position NVDA qty 10 confirmed after T0
    When list_positions for "acc-1" is read
    Then the AAPL position reports source BASELINE with the snapshot as_of
    And the NVDA position reports source ORDERS

  @AC-12 @feature-163 @FR-7
  Scenario: Provenance is consistent across every portfolio read path
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00
    When the AAPL position is read through ListPositions and again through the portfolio-card path (buildAccountPortfolio/ListPortfolios)
    Then both read paths report the same source BASELINE and the same as_of for AAPL

  @AC-13 @feature-163 @FR-4 @FR-7
  Scenario: A symbol with baseline shares and a post-T0 fill reports MIXED provenance
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a BUY of 50 AAPL at filled_avg_price 160.00 with filled_at "2026-08-05T14:30:00Z"
    Then list_positions for "acc-1" returns AAPL qty 150 at avg_entry_price 153.33
    And the AAPL position reports source MIXED with as_of "2026-07-31T23:59:59Z"

  @AC-14 @feature-163 @FR-3 @FR-4
  Scenario: A later full-close snapshot reseats account realized P&L from 600.00 to 0.00
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    And an offline SELL of 30 AAPL at filled_avg_price 170.00 with filled_at "2026-08-10T15:00:00Z" has set the account realized P&L to 600.00
    When snapshot_positions is called with a later as_of "2026-08-31T23:59:59Z", a new client_snapshot_id, and positions_json [{"symbol":"AAPL","qty":70,"avg_cost_per_share":150.00}]
    Then the account realized P&L transitions from 600.00 to 0.00
    And list_positions for "acc-1" returns AAPL qty 70 at avg_entry_price 150.00 with source BASELINE

  @AC-17 @feature-163 @FR-4 @FR-7
  Scenario: A flatten-then-refill symbol reports MIXED even though no baseline shares survive
    Given account "acc-1" holds a baseline AAPL qty 100 @ 150.00 with as_of "2026-07-31T23:59:59Z"
    When an offline order is recorded and confirmed as a SELL of 100 AAPL at filled_avg_price 165.00 with filled_at "2026-08-03T14:00:00Z"
    And an offline order is recorded and confirmed as a BUY of 30 AAPL at filled_avg_price 170.00 with filled_at "2026-08-06T14:00:00Z"
    Then list_positions for "acc-1" returns AAPL qty 30 at avg_entry_price 170.00
    And the AAPL position reports source MIXED with as_of "2026-07-31T23:59:59Z"
