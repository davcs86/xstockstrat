# Durable business-rule suite for xstockstrat-ui (Constitution C-16). Promoted from feature 042's
# acceptance.feature at launch; @feature-042 marks provenance. These are the guarantees a future
# feature must not regress (recon reads this suite; the design-adversary enforces it).
# The /insights P&L Patterns view is backed by analysis QueryPnLPatterns.

Feature: Insights P&L Patterns view
  As a trader, I want a P&L Patterns view that ranks the indicator/signal factors correlated with
  positive and negative realized P&L, reachable from the insights sub-nav.

  @AC-4 @FR-5 @feature-042
  Scenario: The Insights P&L Patterns view renders ranked factor cards
    Given the insights segment is served and QueryPnLPatterns returns positive and negative factors for AAPL
    When a user opens /insights/pnl-patterns
    Then the page loads without error
    And it displays ranked top positive-contributing and top negative-contributing factor cards

  @AC-5 @FR-5 @feature-042
  Scenario: The P&L Patterns view is reachable from the insights sub-nav
    Given the insights segment is served
    When a user reads the PLATFORM_SUBNAV in PlatformHeader
    Then a "P&L Patterns" entry linking to /insights/pnl-patterns is present and navigable
