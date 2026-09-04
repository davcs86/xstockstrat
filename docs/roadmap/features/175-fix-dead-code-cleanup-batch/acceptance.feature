Feature: fix-dead-code-cleanup-batch (bug fix / cleanup)
  Regression guard for comment-audit report items 5–7: removed dead scaffolding stays removed and the
  Node type surface matches the Node 24 runtime, with no build/lint/test regression.

  @AC-1 @regression @item-5
  Scenario: The dead getEnvBool is gone from the Go config packages
    Given the three Go services (trading, portfolio, marketdata)
    When their internal/config packages are inspected and built
    Then getEnvBool (and its suppressor and its dedicated unit test) no longer exist
    And each service still compiles, lints (golangci-lint), and passes its config-package tests

  @AC-2 @regression @item-6
  Scenario: The confirmed-dead propagation middleware is gone from the Node leaf services
    Given the ledger, notify, and config services
    When their src trees are inspected and built
    Then src/middleware/propagation.ts no longer exists
    And each service still builds (tsc) and passes its tests
    And the identity service's propagation.ts is handled per the recorded design decision (deleted or
      documented as intentionally retained), never silently left in an undecided state

  @AC-3 @regression @item-7
  Scenario: The Node type surface matches the Node 24 runtime
    Given the four Node services (ledger, notify, config, identity)
    When their package.json and lockfiles are inspected
    Then @types/node resolves to a ^24 major
    And each service typechecks and builds against it
