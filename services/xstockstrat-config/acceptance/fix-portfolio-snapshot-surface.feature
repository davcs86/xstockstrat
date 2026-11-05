# Promoted from docs/roadmap/features/264-fix-portfolio-snapshot-surface/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-264` tag.
# Durable business rules xstockstrat-config already guarantees. A rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-config - portfolio.snapshot.interval_minutes is a retired key
  The dead key (its periodic writer was never started) is deleted by migration and must not be re-seeded.

  @AC-5 @FR-4 @regression @feature-264
  Scenario: portfolio.snapshot.interval_minutes is retired (FR-4 branch b)
    Given the xstockstrat-config migration set
    When the up migrations are scanned in numeric order for "portfolio.snapshot.interval_minutes" and "snapshot.interval_minutes"
    Then the highest-numbered match deletes the key from config.config_values in namespace "portfolio"
    And no migration from that one onward inserts either key form
    And after the migrations are applied, neither the "production" nor the "staging" listing for service "portfolio" contains "portfolio.snapshot.interval_minutes"
