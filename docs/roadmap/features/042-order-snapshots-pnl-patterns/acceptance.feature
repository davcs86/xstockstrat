# Acceptance scenarios for feature 042 — order-snapshots-pnl-patterns.
# @AC-* IDs are append-only; each Scenario traces to a test step at /sdd-spec (Constitution C-15).
# Behavior reflects the design-approved ledger-event-driven, analysis-centric architecture
# (Trading captures snapshots; portfolio emits portfolio.position.closed; analysis consumes the
# ledger StreamEvents to run pattern analysis and expose QueryPnLPatterns).

Feature: Order snapshots and P&L pattern attribution
  As a trader, I want to see which indicator values and signals were present at each order
  event so that I can learn which factors correlate with positive or negative realized P&L.

  @AC-1 @FR-1 @FR-2
  Scenario: Filling an order captures a snapshot with indicator and signal context
    Given a paper-mode order for AAPL, side buy, quantity 10 is created and filled
    And xstockstrat-indicators and xstockstrat-ingest return values within the configured timeout
    Then an order_snapshots row exists linked to that order id and position id
    And the row's event_type is "filled"
    And the row's indicators map is non-empty and its signals list is non-empty

  @AC-2 @FR-3
  Scenario: Closing a position triggers pattern analysis and materializes factor rows
    Given a position on AAPL with at least 5 completed trades and stored order snapshots
    When the position closes and portfolio emits a portfolio.position.closed event to the ledger
    Then analysis consumes the ledger event and writes pnl_pattern_factors rows within 10 seconds of the close event

  @AC-3 @FR-4
  Scenario: QueryPnLPatterns returns ranked positive and negative factors
    Given AAPL has at least 5 completed trades whose snapshots have been analyzed
    And analysis.patterns.min_sample_count is 5
    When QueryPnLPatterns is called with symbol "AAPL" and limit 10
    Then the response contains at least one factor in positive_factors and at least one in negative_factors
    And each returned factor carries factor_name, factor_type (INDICATOR or SIGNAL), sample_count, and avg_pnl_impact

  @AC-4 @FR-5
  Scenario: The Insights P&L Patterns view renders ranked factor cards
    Given the insights segment is served and QueryPnLPatterns returns positive and negative factors for AAPL
    When a user opens /insights/pnl-patterns
    Then the page loads without error
    And it displays ranked top positive-contributing and top negative-contributing factor cards

  @AC-5 @FR-5
  Scenario: The P&L Patterns view is reachable from the insights sub-nav
    Given the insights segment is served
    When a user reads the PLATFORM_SUBNAV in PlatformHeader
    Then a "P&L Patterns" entry linking to /insights/pnl-patterns is present and navigable

  @AC-6 @FR-6 @FR-7
  Scenario: A snapshot-capture timeout never blocks order execution
    Given xstockstrat-indicators does not respond within trading.snapshot.indicator_timeout_ms
    When a paper-mode order for AAPL, side buy, quantity 10 is created and filled
    Then the order proceeds to filled
    And a partial snapshot is stored with an empty indicators map
    And a WARN-level snapshot-degraded event is emitted to xstockstrat-ledger

  @AC-7 @FR-7
  Scenario: Snapshot and pattern events are recorded in the ledger with their event types
    Given an order for AAPL is filled and its position later closes with pattern analysis run
    Then xstockstrat-ledger contains an order-snapshot-captured event and a pnl-pattern-computed event with the correct event types
