# Promoted from docs/roadmap/features/335-seed-curated-templates/acceptance.feature
# Source: @AC-1, @AC-2, @AC-9, @AC-20, @AC-23, @AC-27, @AC-28, @AC-39 — indicators scenarios
Feature: seed-curated-templates (indicators)
  Acceptance scenarios for the xstockstrat-indicators service promoted from feature 335.
  Covers the seeded formula template catalog, its executable instantiation, replay and down-migration
  safety for the seed, read-only system templates, and the pin of the composite template to the system formula.

  @AC-1 @FR-1 @feature-335
  Scenario: Formula catalog is seeded with the 9 curated formulas
    Given a database with all indicators migrations applied and no admin-authored templates
    When "bob" calls ListTemplates on indicators
    Then the response contains exactly 9 templates at version 1
    And their names are "Volatility Trailing Stop Direction", "Bollinger Squeeze Percentile", "Fundamentals Value+Quality Composite (template)", "SMA Trend Slope (fractional)", "Momentum Quality (Clenow)", "Kaufman Efficiency Ratio", "Mean-Reversion Z-Score", "rolling_zscore_v2" and "kaufman_efficiency_ratio_v2"

  @AC-2 @FR-1 @feature-335
  Scenario: A seeded formula template instantiates into an executable private formula
    Given the seeded template named "Volatility Trailing Stop Direction"
    When "bob" instantiates it and runs the copy over 60 daily closes with period 22 and multiplier 3.0
    Then "bob" owns a new formula with parameters "period" (default 22) and "multiplier" (default 3.0)
    And the run returns series "value" and "stop_line" of length 60

  @AC-9 @FR-6 @feature-335
  Scenario: The down migration removes only seeded rows
    Given the seeded catalog plus an admin-authored formula template "tpl-admin-custom"
    When the indicators seed migration's down SQL is executed
    Then indicators.formula_templates holds exactly 1 row with template_id "tpl-admin-custom"

  @AC-20 @FR-11 @feature-335
  Scenario: The fundamentals composite template cannot drift from the system formula
    Given the seeded template "Fundamentals Value+Quality Composite (template)"
    When its payload is compared with app/formulas/fundamentals_value_quality.py
    Then source, parameters, outputs and fundamentalInputs are equal

  @AC-23 @FR-6 @feature-335
  Scenario: Replaying a seed migration keeps a row a later migration moved to version 2
    Given the indicators seed has been applied and "tpl-kaufman_efficiency_ratio" was then set to version 2 by SQL
    When the indicators seed migration's up SQL is executed a second time
    Then indicators.formula_templates still holds 9 rows
    And "tpl-kaufman_efficiency_ratio" is still at version 2

  @AC-27 @FR-12 @feature-335
  Scenario: Creating a template under a seeded id is refused
    Given the seeded formula template "tpl-kaufman_efficiency_ratio"
    When an admin calls ManageTemplate CREATE with template_id "tpl-kaufman_efficiency_ratio"
    Then the call fails with ALREADY_EXISTS

  @AC-28 @FR-12 @feature-335
  Scenario: An admin-authored template stays editable
    Given a formula template "tpl-admin-custom" created by admin "admin1"
    When "admin1" calls ManageTemplate UPDATE and then RETIRE on it
    Then the UPDATE returns version 2 and the RETIRE sets retired_at
    And ListTemplates returns it with read_only false before the retire

  @AC-39 @FR-6 @feature-335
  Scenario: A seed migration fails when a seeded id is held by a non-system row
    Given indicators.formula_templates already holds "tpl-kaufman_efficiency_ratio" with created_by "admin1"
    When the indicators seed migration's up SQL is executed
    Then it fails with an error naming a seeded template_id held by a non-system row
