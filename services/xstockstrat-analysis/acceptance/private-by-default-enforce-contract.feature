# Promoted from docs/roadmap/features/225-private-by-default-enforce-contract/acceptance.feature
# Source: @AC-3, @AC-8, @AC-14, @AC-15, @AC-16, @AC-17 — analysis scenarios
Feature: private-by-default-enforce-contract (analysis)
  Acceptance scenarios for the xstockstrat-analysis service promoted from feature 225.
  Covers the fail-closed inbound identity gate (headerless and ungranted system callers), the
  owner-scoped QueryPnLPatterns read, and the backtest_runs owner backfill before NOT NULL.

  @AC-3 @FR-3 @feature-225
  Scenario: Ownerless backtest runs are backfilled, then the column is NOT NULL
    Given an "analysis.backtest_runs" row "r-1" with "user_id" NULL whose strategy "s-1" has exactly one owner "u-1"
    And an "analysis.backtest_runs" row "r-2" with "user_id" NULL whose strategy has no owner
    When analysis migration "027_contract_owner_dimension.up.sql" is applied with SEED_USER_ID "seed-1"
    Then row "r-1" has "user_id" "u-1" and row "r-2" has "user_id" "seed-1"
    And inserting a row into "analysis.backtest_runs" with "user_id" NULL fails with a NOT NULL violation

  @AC-8 @FR-1 @feature-225
  Scenario: A headerless owner-scoped call is rejected in analysis
    Given a gRPC call to analysis "ListStrategies" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"

  @AC-14 @FR-7 @feature-225
  Scenario: QueryPnLPatterns returns only the caller's own pattern samples
    Given pattern samples for AAPL from positions owned by user "u-1" and from positions owned by user "u-2", each set at least "analysis.patterns.min_sample_count"
    And factor "sig:newsletter-b" appears only in u-2's samples
    When user "u-1" calls analysis "QueryPnLPatterns" for symbol "AAPL" with "x-user-id: u-1"
    Then no returned factor is "sig:newsletter-b"
    And every returned factor's sample_count counts only u-1's samples

  @AC-15 @FR-7 @feature-225
  Scenario: A headerless QueryPnLPatterns is rejected
    Given a gRPC call to analysis "QueryPnLPatterns" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"

  @AC-16 @FR-1 @feature-225
  Scenario: An ungranted system identity is refused by analysis
    Given a gRPC call to analysis "ListStrategies" with "x-user-id: system" and no internal-caller grant
    When the call is served
    Then it fails with status "PERMISSION_DENIED"

  @AC-17 @FR-1 @feature-225
  Scenario: An ownerless order event issues no owner-scoped call
    Given an "order.filled" ledger event whose payload "user_id" is empty
    When the analysis P&L pattern consumer processes it
    Then no call is made to ingest or indicators
    And the order snapshot is stored and an "analysis.snapshot.degraded" event is emitted
