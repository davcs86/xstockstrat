# Promoted from docs/roadmap/features/224-private-by-default-templates/acceptance.feature
# Source: @AC-25 — agent scenarios
Feature: private-by-default-templates (agent)
  Acceptance scenarios for the xstockstrat-agent service promoted from feature 224.
  Covers the template MCP tools and the removal of public-visibility tool arguments.

  @AC-25 @FR-12 @feature-224
  Scenario: Agent tools expose templates and drop public arguments
    Given the agent MCP tool catalog at GET /api/tools
    When the catalog is listed
    Then "list_templates" and "instantiate_template" are present
    And "manage_formula" has no "is_public" parameter and "list_formulas" has no "include_public" parameter
