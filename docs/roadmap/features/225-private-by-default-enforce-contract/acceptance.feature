Feature: private-by-default-enforce-contract
  As a platform operator, I want feature 224's release-N transitional allowances removed once it is
  launched, so that every owner-scoped read and write fails closed and no dead N-1 objects remain.

  @AC-1 @FR-1
  Scenario: A headerless owner-scoped call is rejected
    Given a gRPC call to indicators "ListFormulas" with no "x-user-id" header and no internal-caller grant
    When the call is served
    Then it fails with status "UNAUTHENTICATED"
    And no formula rows are returned

  @AC-2 @FR-2
  Scenario: The analysis formula-read bypass is gone
    Given a formula "f-1" owned by user "u-1"
    And a call to indicators "GetFormula" for "f-1" with "x-internal-caller: analysis", SAN "xstockstrat-analysis" and no "x-user-id"
    When the call is served
    Then it fails with status "UNAUTHENTICATED"

  @AC-3 @FR-3
  Scenario: A backtest run cannot be stored without an owner
    Given analysis migration 027 is applied
    When a row is inserted into "analysis.backtest_runs" with "user_id" NULL
    Then the insert fails with a NOT NULL violation

  @AC-4 @FR-4
  Scenario: N-1 compatibility objects are dropped
    Given migrations analysis 027, indicators 008 and ingest 014 are applied
    When "pg_trigger" is queried for "tgname LIKE '%_n1_owner_fill%'"
    Then it returns 0 rows
    And "to_regclass('analysis.strategy_scores')" is NULL

  @AC-5 @FR-5
  Scenario: A contract migration whose expand file is not yet on main is rejected
    Given a PR adds "services/xstockstrat-analysis/migrations/027_*.up.sql" with "-- contract-of: services/xstockstrat-analysis/migrations/026_owner_dimension_templates.up.sql"
    And that expand file is not on "origin/main"
    When the "migration-contract-gate" CI job runs
    Then it exits non-zero naming the 027 file

  @AC-6 @FR-5
  Scenario: A contract migration's down-file refuses to run
    Given analysis migration 027 is applied
    When "027_*.down.sql" is executed
    Then it raises an exception
    And "analysis.backtest_runs.user_id" is still NOT NULL

  @AC-7 @FR-6
  Scenario: No LEGACY_GLOBAL credential path remains
    Given an "mcp_client" source owned by user "u-1"
    When ingest resolves its bearer credential
    Then it calls config "GetSecret" with "user_id" "u-1" on the per-user key "ingest.mcp_credential.<uuid>"
    And no code path reads a global "ingest.mcp_credential.*" key
