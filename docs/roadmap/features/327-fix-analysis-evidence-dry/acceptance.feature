Feature: fix-analysis-evidence-dry (bug fix)
  Regression guard for defect reports: evidence fingerprint ignores referenced formula content;
  entry-backfill duplicates the live-enabled gate SQL.

  # guards: docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md
  @AC-1 @regression
  Scenario: editing a referenced custom formula stops pre-edit evidence feeding the grade
    Given a strategy with a CUSTOM_FORMULA component on formula F
    And evidence cells from backtests of several symbols under F's current source
    When UpdateFormula changes F's source materially
    And ScoreStrategy runs for the strategy
    Then the headline grade does not aggregate the evidence cells produced before the edit

  # guards: docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md
  @AC-2 @regression
  Scenario: the boot entry-backfill selects strategies through LIVE_ENABLED_PREDICATE_SQL
    Given strategies S1 (active, live_enabled), S2 (active, not live_enabled) and S3 (inactive, live_enabled)
    When the boot entry-time backfill selects strategies
    Then it selects exactly the strategies StrategiesRepository.list_live_enabled returns (S1)
    And its predicate is the LIVE_ENABLED_PREDICATE_SQL constant, not a re-typed literal
