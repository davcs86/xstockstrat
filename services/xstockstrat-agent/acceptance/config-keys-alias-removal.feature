# Promoted from docs/roadmap/features/306-config-keys-alias-removal/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-306` tag.
# Durable business rule xstockstrat-agent guarantees: get_config returns the config server's values as served.

Feature: xstockstrat-agent - get_config returns server values unfiltered
  What xstockstrat-agent guarantees: the get_config tool applies no alias filter to the config server's response.

  @AC-4 @FR-4 @feature-306
  Scenario: The agent returns the server's values unfiltered
    Given the config server returns namespace "marketdata" values {"fmp.enabled": true}
    When the agent runs get_config for namespace "marketdata"
    Then it returns {"fmp.enabled": true} and applies no alias filter
