Feature: fix-ci-enforcement-gaps (bug fix)
  Regression guard for two CI enforcement-gap defect reports (Node-leaf c8 threshold, scripts/ ruff).

  # guards: docs/reports/2026-10-28-node-leaf-c8-check-coverage-unenforced-defect.md
  @AC-1 @regression
  Scenario: A Node leaf below 40% line coverage fails its coverage run
    Given services/xstockstrat-notify on a tree whose line coverage is below 40%
    When pnpm run test:coverage runs as the CI node-test job does
    Then the command exits non-zero and the node-test job fails

  # guards: docs/reports/2026-10-29-scripts-ruff-lint-gap-defect.md
  @AC-2 @regression
  Scenario: scripts/ Python is ruff-clean and CI enforces it
    Given a pull request that touches a Python file under scripts/
    When CI runs
    Then a job runs ruff check scripts/ and ruff format --check scripts/
    And both exit 0 on the fix commit, and a newly introduced unused import under scripts/ fails the job
