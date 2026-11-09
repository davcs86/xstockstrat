# Promoted from docs/roadmap/features/304-config-keys-relative-consumers/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-304` tag.

Feature: xstockstrat-analysis - namespace-relative config reads
  What xstockstrat-analysis guarantees: the marketdata provider is read through the second watcher with a relative key.

  @AC-4 @FR-1 @feature-304
  Scenario: Analysis reads the marketdata provider through its second watcher
    Given the analysis service has a second watcher for namespace "marketdata" storing "fundamentals.provider" = "edgar"
    And the alias is off
    When the fundamentals signal producer resolves its provider
    Then it reads "fundamentals.provider" and gets "edgar", not ""
