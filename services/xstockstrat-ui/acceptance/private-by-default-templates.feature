# Promoted from docs/roadmap/features/224-private-by-default-templates/acceptance.feature
# Source: @AC-24 — ui scenarios
Feature: private-by-default-templates (ui)
  Acceptance scenarios for the xstockstrat-ui service promoted from feature 224.
  Covers removal of every public-visibility control and the Templates catalog entry in the shared nav.

  @AC-24 @FR-12 @feature-224
  Scenario: UI has no public controls and offers templates
    Given "bob" is signed in to /insights
    When "bob" opens the formulas library
    Then no "Public" checkbox, badge or filter is rendered
    And a "Templates" entry in the rendered nav (NAV_GROUPS, mirrored in PLATFORM_SUBNAV) lists the catalog with a "Use template" action
