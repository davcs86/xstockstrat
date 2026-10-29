Feature: fix-identity-ledger-test-suites (bug fix)
  Regression guard for docs/reports/2026-10-20-node-impl-test-suites-never-load-impl-defect.md:
  the identity and ledger unit suites never load their service implementation, so impl tests pass vacuously.

  @AC-1 @FR-1 @regression
  Scenario: the identity suite executes against the real IdentityServiceImpl
    Given the identity test run used by CI ("pnpm run test:coverage" in services/xstockstrat-identity)
    When the suite runs
    Then the run exits 0 with the identityServiceImpl.test.ts tests reported as passed
    And a mutation that removes single-use revocation of the presented refresh token in refreshOAuthToken makes the "rotates the refresh token and mints a new aud-bound access JWT" test fail

  @AC-2 @FR-2 @regression
  Scenario: the ledger suite executes against the real LedgerServiceImpl and EventNotifier
    Given the ledger test run used by CI ("pnpm run test:coverage" in services/xstockstrat-ledger)
    When the suite runs
    Then the run exits 0 with the ledgerServiceImpl.test.ts and eventNotifier.test.ts tests reported as passed
    And removing the duplicate-key branch from appendEvent (services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:84-105) makes the "idempotent path: returns the stored event on a duplicate key (no second insert)" test fail
    And removing the sub.onEvent(row) call from EventNotifier.dispatch (services/xstockstrat-ledger/src/services/eventNotifier.ts:132) makes the "fans out an event to a matching subscriber" test fail

  @AC-3 @FR-3 @regression
  Scenario Outline: an unloadable test subject fails the run instead of passing
    Given in services/<service>, the subject import in <test_file> points at the nonexistent module "<missing>"
    When "pnpm run test:coverage" runs in services/<service>
    Then the command exits non-zero
    And no test in <test_file> is reported as passed

    Examples:
      | service              | test_file                                 | missing                             |
      | xstockstrat-identity | src/__tests__/identityServiceImpl.test.ts | ../grpc/identityServiceImpl.missing |
      | xstockstrat-ledger   | src/__tests__/ledgerServiceImpl.test.ts   | ../grpc/ledgerServiceImpl.missing   |
      | xstockstrat-ledger   | src/__tests__/eventNotifier.test.ts       | ../services/eventNotifier.missing   |

  @AC-4 @FR-4 @regression
  Scenario: the coverage gate measures the implementation
    Given each service's c8-wrapped "pnpm run test:coverage" run
    When "pnpm run test:coverage" runs in services/xstockstrat-identity and services/xstockstrat-ledger
    Then the identity coverage report has a row with non-zero line coverage for identityServiceImpl and for authz
    And the ledger coverage report has a row with non-zero line coverage for ledgerServiceImpl and for eventNotifier
    And "c8 check-coverage --lines 40", run in each of those services right after its run, exits 0 and the report shows a numeric All files % Lines of at least 40
    # Rows are matched by module name, whether c8 reports them under src/ or dist/.

  @AC-5 @FR-5
  Scenario Outline: existing tests still pass once they actually execute
    Given the tests in services/<service>/src/__tests__ on main-dev
    When "pnpm run test:coverage" runs in services/<service> after the fix
    Then the test summary reports 0 failed tests
    And no existing test is deleted, marked skip or todo, or has an assertion removed

    Examples:
      | service              |
      | xstockstrat-identity |
      | xstockstrat-ledger   |

  @AC-6 @FR-3 @regression
  Scenario Outline: a compiled test whose compiled subject is missing fails instead of passing
    Given "tsc" has completed in services/<service>
    And "node --test --test-reporter=tap <compiled_test>" exits 0 with a "# pass" count above 0
    When <compiled_subject> is deleted and "node --test --test-reporter=tap <compiled_test>" runs again
    Then the command exits non-zero
    And the TAP summary reports "# pass 0"

    Examples:
      | service              | compiled_test                              | compiled_subject                 |
      | xstockstrat-identity | dist/__tests__/identityServiceImpl.test.js | dist/grpc/identityServiceImpl.js |
      | xstockstrat-ledger   | dist/__tests__/ledgerServiceImpl.test.js   | dist/grpc/ledgerServiceImpl.js   |
      | xstockstrat-ledger   | dist/__tests__/eventNotifier.test.js       | dist/services/eventNotifier.js   |
