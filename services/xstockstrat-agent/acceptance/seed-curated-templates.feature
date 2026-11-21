# Promoted from docs/roadmap/features/335-seed-curated-templates/acceptance.feature
# Source: @AC-30 — agent scenarios
Feature: seed-curated-templates (agent)
  Acceptance scenarios for the xstockstrat-agent service promoted from feature 335.
  Covers the list_templates tool reporting read-only templates.

  @AC-30 @FR-15 @feature-335
  Scenario: The agent reports read-only templates
    Given the seeded strategy template "tpl-quality_dip_buyer"
    When list_templates is called with kind "strategy"
    Then its meta contains "readOnly": true
