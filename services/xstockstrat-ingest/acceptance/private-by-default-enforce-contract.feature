# Promoted from docs/roadmap/features/225-private-by-default-enforce-contract/acceptance.feature
# Source: @AC-4, @AC-9, @AC-13 — ingest scenarios
Feature: private-by-default-enforce-contract (ingest)
  Acceptance scenarios for the xstockstrat-ingest service promoted from feature 225.
  Covers the fail-closed identity gate on IngestSignal, the dropped N-1 compatibility objects, and
  the refusing contract down-file.

  @AC-4 @FR-4 @feature-225
  Scenario: N-1 compatibility objects are dropped
    Given migrations "027_contract_owner_dimension.up.sql" (analysis) and "014_contract_signal_ownership.up.sql" (ingest) are applied
    When "pg_trigger" is queried for "tgname = 'newsletter_signals_n1_owner_fill'"
    Then it returns 0 rows
    And "to_regprocedure('ingest.n1_owner_fill_signals()')" is NULL
    And "to_regclass('ingest.signal_dedup_keys')" is NULL
    And "to_regclass('analysis.strategy_scores')" is NULL

  @AC-9 @FR-1 @feature-225
  Scenario: A headerless owner-scoped call is rejected in ingest
    Given signal source "newsletter-a" is owned by user "u-1" only
    And a gRPC call to ingest "IngestSignal" for source "newsletter-a" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"
    And no row is written to "ingest.newsletter_signals"

  @AC-13 @FR-5 @feature-225
  Scenario: The ingest contract down-file refuses to run
    Given ingest migration "014_contract_signal_ownership.up.sql" is applied
    When "migrate goto 13" is run for the ingest schema
    Then it exits non-zero with output containing "irreversible contract"
    And the ingest migration state is dirty
    And "to_regclass('ingest.signal_dedup_keys')" is still NULL
