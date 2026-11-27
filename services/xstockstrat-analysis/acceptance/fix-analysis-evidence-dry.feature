# Promoted from docs/roadmap/features/327-fix-analysis-evidence-dry/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-327` tag.

Feature: fix-analysis-evidence-dry (bug fix)
  Regression guard for defect reports: evidence fingerprint ignores referenced formula content;
  entry-backfill duplicates the live-enabled gate SQL.

  # guards: docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md
  @AC-1 @regression @feature-327
  Scenario: editing a referenced custom formula stops pre-edit evidence feeding the grade
    Given a strategy with a CUSTOM_FORMULA component on formula F
    And evidence cells from backtests of several symbols under F's current source
    When UpdateFormula changes F's source materially
    And ScoreStrategy runs for the strategy
    Then the headline grade does not aggregate the evidence cells produced before the edit

  # guards: docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md
  @AC-2 @regression @feature-327
  Scenario: the boot entry-backfill selects strategies through LIVE_ENABLED_PREDICATE_SQL
    Given strategies S1 (active, live_enabled), S2 (active, not live_enabled) and S3 (inactive, live_enabled)
    When the boot entry-time backfill selects strategies
    Then it selects exactly the strategies StrategiesRepository.list_live_enabled returns (S1)
    And when a test narrows LIVE_ENABLED_PREDICATE_SQL so that S1 no longer matches, the backfill selects no strategy, with no edit to entry_backfill.py

  # design.md step 7 (D-9): a score-time refusal resolves through the newest formula-aware fingerprint
  @AC-3 @regression @feature-327
  Scenario: a score-time formula refusal grades on the newest formula-aware evidence, never on pre-feature cells
    Given a strategy "s-1" with a CUSTOM_FORMULA component on formula "f-9"
    And evidence cells stamped with the bare definition hash "<def_hash>" (pre-feature) for AAPL and MSFT
    And evidence cells stamped with the formula-aware fingerprint "<def_hash>.<suffix>" for AAPL
    When GetFormula for "f-9" fails with NOT_FOUND and ScoreStrategy runs for "s-1"
    Then the grade aggregates only the "<def_hash>.<suffix>" cells (evidence_symbols is 1)
    And with no formula-aware cells at all it aborts NOT_FOUND with a message naming formula "f-9" as not readable

  # design.md step 7 (D-10): the gate-off availability coupling, operator sign-off 2026-11-20
  @AC-4 @regression @feature-327
  Scenario: with the fundamentals gate off, a GetFormula outage aborts ScoreStrategy without touching the grade
    Given analysis.backtest.fundamentals.enabled is false and strategy "s-1" has a CUSTOM_FORMULA component on formula "f-9"
    And "s-1" holds a headline grade
    When GetFormula for "f-9" fails with UNAVAILABLE and ScoreStrategy runs for "s-1"
    Then it aborts UNAVAILABLE "formula version unavailable — grade unchanged"
    And no evidence cell is read and the stored grade is neither deleted nor rewritten

  # design.md step 6 (operator decision 2026-11-20): pop only when the definition hash changes
  @AC-5 @regression @feature-327
  Scenario: a rename during a GetFormula outage keeps the grade
    Given a strategy "s-1" with a CUSTOM_FORMULA component on formula "f-9" and a headline grade
    When ManageStrategy UPDATE renames "s-1" (update_mask display_name only) while GetFormula for "f-9" fails with UNAVAILABLE
    Then the update succeeds and the headline grade of "s-1" is still served and is not deleted
