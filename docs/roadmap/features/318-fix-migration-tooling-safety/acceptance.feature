Feature: fix-migration-tooling-safety (bug fix)
  Regression guard for clustered defect reports: dirty-state recovery never replays non-idempotent up-files, and a
  migration numbered below the target branch's maximum cannot merge.

  # guards: docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md
  @AC-1 @regression
  Scenario: dirty recovery for a service without a contract floor does not replay from 001
    Given services/xstockstrat-indicators/migrations has no "-- contract-of:" migration
    And the indicators schema_migrations row is "5 (dirty)"
    And indicators 001_formulas.up.sql contains a bare "CREATE TABLE indicators.formulas ("
    When scripts/db-migrate.sh up runs
    Then migrate force 0 is not executed for indicators
    And indicators either ends at the latest version clean or the run stops naming "migrate force 4" as the recovery

  # guards: docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md
  @AC-2 @regression
  Scenario: CI rejects a new migration numbered below the target branch maximum
    Given main-dev's services/xstockstrat-config/migrations maximum is 025
    When a PR adds services/xstockstrat-config/migrations/024_late_seed.up.sql
    Then the CI migration-ordering check fails naming 024 and the current maximum 025
