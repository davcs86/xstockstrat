# Promoted from docs/roadmap/features/304-config-keys-relative-consumers/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-304` tag.

Feature: xstockstrat-ui - namespace-relative config reads
  What xstockstrat-ui guarantees: the positions banner reads the platform key by its relative spelling.

  @AC-5 @FR-1 @feature-304
  Scenario: The trader positions banner reads the relative platform key
    Given the platform config returns values {"trading_state": "REDUCE_ONLY"}
    When an operator opens /trader/positions
    Then the REDUCE_ONLY banner is shown
