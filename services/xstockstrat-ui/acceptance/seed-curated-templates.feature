# Promoted from docs/roadmap/features/335-seed-curated-templates/acceptance.feature
# Source: @AC-29 — ui scenarios
Feature: seed-curated-templates (ui)
  Acceptance scenarios for the xstockstrat-ui service promoted from feature 335.
  Covers the config-ui templates page showing system templates as read-only.

  @AC-29 @FR-15 @feature-335
  Scenario: Config-ui shows system templates as read-only
    Given the config-ui templates page lists system template "tpl-quality_dip_buyer" and admin template "tpl-admin-custom"
    When an admin opens the page
    Then the "tpl-quality_dip_buyer" row shows a "System" badge and no Edit or Retire action
    And the "tpl-admin-custom" row shows Edit and Retire
