# Durable business-rule suite for xstockstrat-ui (Constitution C-16). Promoted from feature 156's
# acceptance.feature on code-completion; @feature-156 marks provenance. These are the guarantees a
# future feature must not regress (recon reads this suite; the design-adversary enforces it).

Feature: config-ui — Run fundamentals scan admin control
  The config-ui segment exposes an admin-only manual trigger for the fundamentals producer, gated at
  the BFF by admin scope and reachable from config-ui navigation.

  @AC-9 @feature-156
  Scenario: The config-ui trigger control is admin-gated
    Given the config-ui "Run fundamentals scan" control
    When a non-admin session reaches the BFF route
    Then the admin-forwarding BFF gate rejects the request
    And the control is reachable from config-ui navigation for an admin session
