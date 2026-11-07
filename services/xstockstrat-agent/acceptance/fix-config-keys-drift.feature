# Promoted from docs/roadmap/features/295-fix-config-keys-drift/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-295` tag.
# Durable business rules xstockstrat-agent guarantees for config subscription and startup readiness.

Feature: xstockstrat-agent - config subscription
  What xstockstrat-agent guarantees: it reads config from a live subscription and does not serve tools before its snapshots arrive.

  @AC-8 @FR-8 @regression @feature-295
  Scenario: The agent observes a config change without a per-call GetConfig
    Given the agent has subscribed to namespace "agent"
    When an operator sets "agent" / "signal.alert_threshold" to 0.9
    Then the next ingest_signal applies threshold 0.9
    And no GetConfig RPC was issued for that read

  @AC-37 @FR-8 @regression @feature-295
  Scenario: The agent does not serve tools before its config snapshots arrive
    Given the config service does not answer WatchConfig for namespace "indicators"
    When the agent starts
    Then the agent does not report ready within 90 seconds and fails its startup
