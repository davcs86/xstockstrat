# Durable per-service business rules for xstockstrat-ui, promoted from feature 043's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-043` tag. These are the guarantees a future feature must not silently break.

Feature: user-management-ui (ui)
  The config-ui Users section — navigation entry and the admin user-list page.

  @AC-9 @FR-9 @feature-043
  Scenario: The Users section is reachable within config-ui
    Given an admin is signed in to the "/config-ui" segment of xstockstrat-ui
    When the admin opens the shared config-ui navigation
    Then a "Users" section is present and links to the user list page
    And the user list page renders each user's email, roles, active status, and created date
