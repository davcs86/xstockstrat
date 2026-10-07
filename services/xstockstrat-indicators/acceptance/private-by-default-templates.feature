# Promoted from docs/roadmap/features/224-private-by-default-templates/acceptance.feature
# Source: @AC-1, @AC-2, @AC-3, @AC-4, @AC-13, @AC-14, @AC-16, @AC-17, @AC-22, @AC-28, @AC-31 — indicators scenarios
Feature: private-by-default-templates (indicators)
  Acceptance scenarios for the xstockstrat-indicators service promoted from feature 224.
  Covers owner-only formula reads/executes/lists, header-only authorship, the deprecated is_public flag,
  the admin-curated formula template catalog and its private-snapshot instantiation, the formula
  migration, and admin read-only access to other users' formulas.

  @AC-1 @FR-1 @feature-224
  Scenario: Another user's formulas are invisible even if formerly public
    Given user "alice" owns formula "f-zscore" with source "result = {'value': 1}" that was is_public=true before migration
    When user "bob" calls GetFormula with formula_id "f-zscore"
    Then the call fails with gRPC status NOT_FOUND
    And ExecuteFormula with formula_id "f-zscore" as "bob" fails with NOT_FOUND

  @AC-2 @FR-1 @feature-224
  Scenario: ListFormulas returns only the caller's own and system formulas
    Given "alice" owns formulas "f-a1" and "f-a2", "bob" owns "f-b1", and system formula "d1ff5e6b-6d9c-589d-b95e-defd862c702b" exists
    When "bob" calls ListFormulas with author_filter "alice" and include_public true
    Then the response contains exactly formula ids "f-b1" and "d1ff5e6b-6d9c-589d-b95e-defd862c702b"

  @AC-3 @FR-1 @feature-224
  Scenario: Setting is_public has no effect
    Given "alice" registers formula "f-new" with is_public true
    When "bob" calls GetFormula with formula_id "f-new"
    Then the call fails with NOT_FOUND
    And the stored FormulaDefinition for "f-new" read by "alice" has is_public false

  @AC-4 @FR-2 @feature-224
  Scenario: Body author cannot impersonate another user or the system
    Given the caller header x-user-id is "bob"
    When "bob" calls RegisterFormula with author "system" and name "sneaky"
    Then the stored formula "sneaky" has author "bob"

  @AC-13 @FR-7 @feature-224
  Scenario: Only admins can author templates
    Given "bob" has no ADMIN scope bit
    When "bob" calls ManageTemplate CREATE with kind FORMULA and name "Z-Score"
    Then the call fails with PERMISSION_DENIED

  @AC-14 @FR-7 @feature-224
  Scenario: Any user can browse the catalog and updates bump the version
    Given an admin created formula template "tpl-zscore" (version 1)
    When the admin updates "tpl-zscore" source
    Then ListTemplates as "bob" returns "tpl-zscore" with version 2

  @AC-16 @FR-8 @feature-224
  Scenario: Instantiation creates an independent private snapshot
    Given formula template "tpl-zscore" at version 2
    When "bob" calls InstantiateTemplate for "tpl-zscore"
    Then a new formula owned by "bob" exists with origin_template_id "tpl-zscore" and origin_template_version 2
    And "alice" calling GetFormula on the new formula id fails with NOT_FOUND

  @AC-17 @FR-8 @feature-224
  Scenario: Template updates never mutate existing instances
    Given "bob" instantiated "tpl-zscore" at version 2 into formula "f-bob-z"
    When the admin updates "tpl-zscore" to version 3 with a new source
    Then "f-bob-z" source is unchanged
    And reading "f-bob-z" reports origin version 2 and an update-available indicator with latest version 3

  @AC-22 @FR-11 @feature-224
  Scenario: Migration preserves data and makes public formulas private
    Given 8 formulas with is_public=true authored by "user-a@example.test", "user-b" and "system"
    When the migration runs
    Then all 8 formulas still exist with unchanged source and author
    And none of the non-system formulas are readable by a different user

  @AC-28 @FR-13 @feature-224
  Scenario: Admins can read but not change another user's objects
    Given "admin" has the ADMIN scope bit and "alice" owns private formula "f-zscore"
    When "admin" calls GetFormula for "f-zscore"
    Then the formula is returned and an audit ledger event records "admin" reading "f-zscore"
    And "admin" calling UpdateFormula or DeleteFormula on "f-zscore" fails with PERMISSION_DENIED
    And "admin" calling ExecuteFormula on "f-zscore" fails with PERMISSION_DENIED

  @AC-31 @FR-7 @feature-224
  Scenario: Retiring a template hides it but leaves instances intact
    Given "bob" instantiated formula template "tpl-zscore" into formula "f-bob-z"
    When the admin retires "tpl-zscore"
    Then ListTemplates as "bob" does not contain "tpl-zscore"
    And GetFormula "f-bob-z" as "bob" still returns its source with origin_template_id "tpl-zscore"
