# Promoted from docs/roadmap/features/304-config-keys-relative-consumers/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-304` tag.

Feature: xstockstrat-portfolio - namespace-relative config tests
  What xstockstrat-portfolio guarantees: migration-coupled config tests follow the generated stored set without editing applied migrations.

  @AC-6 @FR-2 @feature-304
  Scenario: A migration-coupled test follows the generated stored set
    Given the portfolio signal-prune interval constant is "watchlist.signal_prune_interval_seconds"
    And scripts/config-wiring-stored.json holds that key under namespace "portfolio"
    When the portfolio test TestSignalPrune_IntervalReadsSeededRow runs
    Then the test passes and no applied migration file is modified
