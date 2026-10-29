# Promoted from feature 252 (fix-identity-ledger-test-suites) per Constitution C-16. Verbatim from its reviewed acceptance.feature.
Feature: ledger unit suite executes the real implementation

  @AC-2 @FR-2 @regression @feature-252
  Scenario: the ledger suite executes against the real LedgerServiceImpl and EventNotifier
    Given the ledger test run used by CI ("pnpm run test:coverage" in services/xstockstrat-ledger)
    When the suite runs
    Then the run exits 0 with the ledgerServiceImpl.test.ts and eventNotifier.test.ts tests reported as passed
    And removing the duplicate-key branch from appendEvent (services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:84-105) makes the "idempotent path: returns the stored event on a duplicate key (no second insert)" test fail
    And removing the sub.onEvent(row) call from EventNotifier.dispatch (services/xstockstrat-ledger/src/services/eventNotifier.ts:132) makes the "fans out an event to a matching subscriber" test fail
