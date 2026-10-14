Feature: private-by-default-enforce-contract
  As a platform operator, I want feature 224's release-N transitional allowances removed once it is
  launched, so that every owner-scoped read and write fails closed and no dead N-1 objects remain.

  @AC-1 @FR-1
  Scenario: A headerless owner-scoped call is rejected in indicators
    Given a gRPC call to indicators "ListFormulas" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"
    And no formula rows are returned

  @AC-8 @FR-1
  Scenario: A headerless owner-scoped call is rejected in analysis
    Given a gRPC call to analysis "ListStrategies" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"

  @AC-9 @FR-1
  Scenario: A headerless owner-scoped call is rejected in ingest
    Given signal source "newsletter-a" is owned by user "u-1" only
    And a gRPC call to ingest "IngestSignal" for source "newsletter-a" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"
    And no row is written to "ingest.newsletter_signals"

  @AC-10 @FR-1
  Scenario: An identified non-owner keeps the non-owner result
    Given a formula "f-1" owned by user "u-1"
    When user "u-2" calls indicators "GetFormula" for "f-1" with "x-user-id: u-2"
    Then it fails with status "NOT_FOUND"

  @AC-2 @FR-2
  Scenario: The analysis formula-read bypass is gone
    Given a formula "f-1" owned by user "u-1"
    And a call to indicators "GetFormula" for "f-1" with "x-user-id: u-2", "x-internal-caller: analysis" and peer SAN "xstockstrat-analysis"
    When the call is served
    Then it fails with status "NOT_FOUND"

  @AC-3 @FR-3
  Scenario: Ownerless backtest runs are backfilled, then the column is NOT NULL
    Given an "analysis.backtest_runs" row "r-1" with "user_id" NULL whose strategy "s-1" has exactly one owner "u-1"
    And an "analysis.backtest_runs" row "r-2" with "user_id" NULL whose strategy has no owner
    When analysis migration "027_contract_owner_dimension.up.sql" is applied with SEED_USER_ID "seed-1"
    Then row "r-1" has "user_id" "u-1" and row "r-2" has "user_id" "seed-1"
    And inserting a row into "analysis.backtest_runs" with "user_id" NULL fails with a NOT NULL violation

  @AC-4 @FR-4
  Scenario: N-1 compatibility objects are dropped
    Given migrations "027_contract_owner_dimension.up.sql" (analysis) and "014_contract_signal_ownership.up.sql" (ingest) are applied
    When "pg_trigger" is queried for "tgname = 'newsletter_signals_n1_owner_fill'"
    Then it returns 0 rows
    And "to_regprocedure('ingest.n1_owner_fill_signals()')" is NULL
    And "to_regclass('ingest.signal_dedup_keys')" is NULL
    And "to_regclass('analysis.strategy_scores')" is NULL

  @AC-11 @FR-4
  Scenario: indicators no longer writes is_public, so the column can be dropped later
    Given a test schema where "indicators.formulas" has no "is_public" column
    When the indicators write statements used by RegisterFormula, UpdateFormula, the startup formula seed upsert and template instantiation are executed against it
    Then all four writes succeed

  @AC-5 @FR-5
  Scenario: A contract migration whose expand file is not yet on main is rejected
    Given a PR adds "services/xstockstrat-analysis/migrations/027_contract_owner_dimension.up.sql" whose line 1 is "-- contract-of: services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql"
    And that expand file is not on "origin/main"
    When the "migration-contract-gate" CI job runs
    Then it exits non-zero naming "027_contract_owner_dimension.up.sql"

  @AC-12 @FR-5
  Scenario: Contract up-files are replay-safe
    Given analysis 027 and ingest 014 have been applied once
    When "scripts/migration-rerun.sh" replays the 224 expand and 225 contract up-files
    Then every replay succeeds, the contracted objects stay absent, and the N-1 trigger count is 0

  @AC-6 @FR-5
  Scenario: A contract migration's down-file refuses to run
    Given analysis migration "027_contract_owner_dimension.up.sql" is applied
    When "migrate goto 26" is run for the analysis schema
    Then it exits non-zero with output containing "irreversible contract"
    And the analysis migration state is dirty
    And "analysis.backtest_runs.user_id" is still NOT NULL

  @AC-7 @FR-6
  Scenario: mcp_client credentials resolve per user only
    Given an "mcp_client" source owned by user "u-1"
    And a global config secret "ingest.mcp_credential.6f1c2a9e-3b7d-4e21-9a55-0c8d1e2f4b10" exists alongside u-1's per-user one
    When ingest resolves its bearer credential
    Then it calls config "GetSecret" with "user_id" "u-1" on the per-user key "ingest.mcp_credential.6f1c2a9e-3b7d-4e21-9a55-0c8d1e2f4b10"
    And the bearer sent is u-1's per-user value, not the global one

  @AC-13 @FR-5
  Scenario: The ingest contract down-file refuses to run
    Given ingest migration "014_contract_signal_ownership.up.sql" is applied
    When "migrate goto 13" is run for the ingest schema
    Then it exits non-zero with output containing "irreversible contract"
    And the ingest migration state is dirty
    And "to_regclass('ingest.signal_dedup_keys')" is still NULL

  @AC-14 @FR-7
  Scenario: QueryPnLPatterns returns only the caller's own pattern samples
    Given pattern samples for AAPL from positions owned by user "u-1" and from positions owned by user "u-2", each set at least "analysis.patterns.min_sample_count"
    And factor "sig:newsletter-b" appears only in u-2's samples
    When user "u-1" calls analysis "QueryPnLPatterns" for symbol "AAPL" with "x-user-id: u-1"
    Then no returned factor is "sig:newsletter-b"
    And every returned factor's sample_count counts only u-1's samples

  @AC-15 @FR-7
  Scenario: A headerless QueryPnLPatterns is rejected
    Given a gRPC call to analysis "QueryPnLPatterns" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"

  @AC-16 @FR-1
  Scenario: An ungranted system identity is refused by analysis
    Given a gRPC call to analysis "ListStrategies" with "x-user-id: system" and no internal-caller grant
    When the call is served
    Then it fails with status "PERMISSION_DENIED"

  @AC-17 @FR-1
  Scenario: An ownerless order event issues no owner-scoped call
    Given an "order.filled" ledger event whose payload "user_id" is empty
    When the analysis P&L pattern consumer processes it
    Then no call is made to ingest or indicators
    And the order snapshot is stored and an "analysis.snapshot.degraded" event is emitted

  @AC-18 @FR-8
  Scenario: db-migrate refuses the force-0 replay for a dirty contract service
    Given analysis migration "027_contract_owner_dimension.up.sql" is applied
    And a refused "migrate goto 26" has left the analysis migration state dirty at version 26
    When "scripts/db-migrate.sh up" runs
    Then it exits non-zero with output naming "analysis" and "force 25"
    And the analysis migration state is still dirty at version 26
    And after "migrate force 25" for the analysis schema, "scripts/db-migrate.sh up" exits 0
    And the analysis migration state is clean at version 27 and "analysis.backtest_runs.user_id" is NOT NULL

  @AC-19 @FR-8
  Scenario: Dirty recovery below the contract floor is unchanged
    Given a migrations directory whose only contract file "027_x.up.sql" declares "-- contract-of: services/xstockstrat-x/migrations/026_y.up.sql"
    When the dirty guard evaluates "20 (dirty)", and separately a directory with no contract file evaluates "27 (dirty)"
    Then both evaluations allow the automatic force-0 recovery
