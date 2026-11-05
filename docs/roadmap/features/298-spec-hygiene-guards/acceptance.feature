Feature: spec-hygiene-guards
  As a platform maintainer, I want the spec-hygiene residuals from the PR #657 audit enforced or corrected in the repo, so that feature numbers stay unambiguous and the dependency graph in the first-loaded context file is true.

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
  Scenario: A pull request cannot add a prefix to the allowlist
    Given the base branch allowlist is exactly 058, 064, 097, 111, 140, 149, 153 and 169
    And the PR head allowlist adds "299" and docs/roadmap/features contains "299-alpha" and "299-beta"
    When the feature-number uniqueness check runs on the pull request
    Then it exits non-zero and its output says allowlist addition "299" is not permitted
