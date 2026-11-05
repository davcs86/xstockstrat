# Promoted from feature 252 (fix-identity-ledger-test-suites) per Constitution C-16. Verbatim from its reviewed acceptance.feature.
Feature: identity unit suite executes the real implementation

  @AC-1 @FR-1 @regression @feature-252
  Scenario: the identity suite executes against the real IdentityServiceImpl
    Given the identity test run used by CI ("pnpm run test:coverage" in services/xstockstrat-identity)
    When the suite runs
    Then the run exits 0 with the identityServiceImpl.test.ts tests reported as passed
    And a mutation that removes single-use revocation of the presented refresh token in refreshOAuthToken makes the "rotates the refresh token and mints a new aud-bound access JWT" test fail
