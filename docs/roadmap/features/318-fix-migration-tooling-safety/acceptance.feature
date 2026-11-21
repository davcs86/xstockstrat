Feature: fix-migration-tooling-safety (bug fix)
  Regression guard for clustered defect reports: dirty-state recovery never replays non-idempotent up-files, and a
  migration numbered below the target branch's maximum cannot merge.

  # guards: docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md
  # The Then was pinned to the refuse branch by operator decision O-1 (2026-11-20, context.md): db-migrate.sh up never
  # recovers a dirty service by itself.
  @AC-1 @regression
  Scenario: dirty recovery for a service without a contract floor does not replay from 001
    Given services/xstockstrat-indicators/migrations has no "-- contract-of:" migration
    And the indicators schema_migrations row is "5 (dirty)"
    And indicators 001_formulas.up.sql contains a bare "CREATE TABLE indicators.formulas ("
    When scripts/db-migrate.sh up runs
    Then no "migrate ... force" command is executed for any service
    And the run exits 1 and no service after indicators is migrated
    And its output carries the line 'Recover: migrate -path services/xstockstrat-indicators/migrations -database "$DATABASE_URL&x-migrations-table=indicators_schema_migrations" force 4'

  # guards: docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md
  @AC-2 @regression
  Scenario: CI rejects a new migration numbered below the target branch maximum
    Given main-dev's services/xstockstrat-config/migrations maximum is 025
    When a PR adds services/xstockstrat-config/migrations/024_late_seed.up.sql
    Then the CI migration-ordering check fails naming 024 and the current maximum 025

  # guards: docs/reports/2026-10-07-db-migrate-dirty-recovery-replay-unsafe-defect.md
  # AC-3..AC-5 were added by /sdd-spec on 2026-11-20 (design.md section 10, operator decision O-3).
  @AC-3 @regression
  Scenario: the recovery names the previous existing version across a numbering gap
    Given a migrations directory for schema "x" holding up-files 001, 002, 003, 005 and 006
    When the dirty guard evaluates "5 (dirty)"
    Then it exits 3 with the line 'Recover: migrate -path services/xstockstrat-x/migrations -database "$DATABASE_URL&x-migrations-table=x_schema_migrations" force 3'
    And its output names "force 6" only as an escalation after "already exists" in version 6
    And its output contains the literal "$DATABASE_URL" and no "postgres://" URL

  @AC-4 @regression
  Scenario: a service dirty at its first migration is told to empty the tracking table
    Given a migrations directory for schema "x" holding up-files 001, 002, 003, 005 and 006
    When the dirty guard evaluates "1 (dirty)"
    Then it exits 3 with the line "Recover: psql "$DATABASE_URL" -c 'TRUNCATE public.x_schema_migrations'"
    And its output contains no "force -1"

  @AC-5 @regression
  Scenario Outline: the dirty guard fails closed when it cannot compute a recovery
    Given a migrations directory for schema "x" holding up-files <files>
    When the dirty guard evaluates "<version>"
    Then it exits 2 naming "cannot compute recovery" and prints no "Recover:" line

    Examples:
      | files                   | version   |
      | (none)                  | 5 (dirty) |
      | 001, 002, 003, 005, 006 | 4 (dirty) |
      | 001, 002, 003, 005, 006 | 7 (dirty) |
