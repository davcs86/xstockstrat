Feature: spec-hygiene-guards
  As a platform maintainer, I want the spec-hygiene residuals from the PR #657 audit enforced or corrected in the repo, so that feature numbers stay unambiguous, the dependency graph in the first-loaded context file is true, and no component invents an account identity.

  @AC-1 @FR-1
  Scenario: A new duplicate feature number fails the check
    Given docs/roadmap/features contains directories "299-alpha" and "299-beta" and the allowlist does not contain "299"
    When the feature-number uniqueness check runs
    Then it exits non-zero and its output names prefix "299" and both "299-alpha" and "299-beta"

  @AC-2 @FR-1 @FR-2
  Scenario: Grandfathered launched duplicates pass
    Given the only shared prefixes are 058, 064, 097, 111, 140, 149, 153 and 169 and the allowlist is exactly those eight prefixes
    When the feature-number uniqueness check runs
    Then it exits 0

  @AC-3 @FR-2
  Scenario: A stale allowlist entry fails the check
    Given the allowlist contains "065" and only "065-cross-stock-score-derivation" exists with that prefix
    When the feature-number uniqueness check runs
    Then it exits non-zero and its output says allowlist entry "065" is stale and must be removed

  @AC-4 @FR-3
  Scenario: The non-launched duplicate is renumbered
    Given "065-second-market-data-vendor" has status "idea" and "065-cross-stock-score-derivation" has status "launched"
    When the renumber step has been applied
    Then exactly one directory under docs/roadmap/features starts with "065-" and it is "065-cross-stock-score-derivation"
    And the slug "second-market-data-vendor" exists under one new unique NNN with status.md still "idea"
    And that directory's context.md and feature.md contain no path containing "065-second-market-data-vendor"

  @AC-5 @FR-4
  Scenario: The dependency graph names only real ledger writers and alert emitters
    Given root CLAUDE.md § Inter-Service Dependencies after the change
    When a reader looks for the ledger and notify edges
    Then the ledger-write edge lists exactly trading, portfolio, marketdata, indicators, ingest, analysis and identity
    And the notify alert edge lists exactly trading, portfolio, marketdata, ingest, analysis and agent
    And no line reads "All services → xstockstrat-ledger" or "All services → xstockstrat-notify"

  @AC-6 @FR-5
  Scenario: Portfolio does not invent an account for a fill with no account_id
    Given a fill for user "u-1" symbol "AAPL" qty 10 price 150.00 with AccountId ""
    When the portfolio position fold processes it
    Then it returns an error whose message contains "account_id"
    And portfolio.positions has no row with account_id "alpaca-default" for user "u-1"

  @AC-7 @FR-5
  Scenario: Analysis skips a P&L event with no account_id instead of attributing it
    Given an order event and a portfolio.position.closed event for user "u-1" symbol "AAPL" whose payload has account_id ""
    When the P&L pattern consumer handles each
    Then a WARN log containing "account_id" is emitted for each
    And no P&L sample or window is written under account_id "alpaca-default"
