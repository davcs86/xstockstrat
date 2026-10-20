Feature: fix-identity-ledger-test-suites (bug fix)
  Regression guard for docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md:
  the identity and ledger unit suites never load their service implementation, so impl tests pass vacuously.

  @AC-1 @regression
  Scenario: the identity suite executes against the real IdentityServiceImpl
    Given the identity test run used by CI ("pnpm run test:coverage" in services/xstockstrat-identity)
    When the suite runs
    Then IdentityServiceImpl is loaded and no impl test returns early because its subject is missing
    And removing the revoke UPDATE from refreshOAuthToken (services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:524-527) makes the "rotates the refresh token and mints a new aud-bound access JWT" test fail

  @AC-2 @regression
  Scenario: the ledger suite executes against the real LedgerServiceImpl and EventNotifier
    Given the ledger test run used by CI ("pnpm run test:coverage" in services/xstockstrat-ledger)
    When the suite runs
    Then LedgerServiceImpl and EventNotifier are loaded and no impl test returns early because its subject is missing

  @AC-3 @regression
  Scenario: an unloadable test subject fails the run instead of passing
    Given an identity or ledger impl test file whose subject module cannot be imported
    When the suite runs
    Then the run reports a failure and exits non-zero

  @AC-4 @regression
  Scenario: the coverage gate measures the implementation
    Given the c8 "--lines 40" threshold in each service's test:coverage script
    When the suite runs in CI
    Then the coverage report includes src/grpc/identityServiceImpl (identity) and src/grpc/ledgerServiceImpl and src/services/eventNotifier (ledger)
    And the 40 percent line threshold still passes
