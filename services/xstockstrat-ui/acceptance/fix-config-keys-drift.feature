# Promoted from docs/roadmap/features/295-fix-config-keys-drift/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-295` tag.
# Durable business rule xstockstrat-ui guarantees for environment-scoped config.

Feature: xstockstrat-ui - environment-scoped config
  What xstockstrat-ui guarantees: production UI renders production config.

  @AC-9 @FR-9 @regression @feature-295
  Scenario: Production UI renders production config
    Given production "platform.trading_state" = "HALTED" and staging = "ACTIVE"
    When a production user opens /trader/positions
    Then the HALTED banner is shown
