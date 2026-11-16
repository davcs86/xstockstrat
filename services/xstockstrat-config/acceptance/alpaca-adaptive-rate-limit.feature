# Promoted from docs/roadmap/features/347-alpaca-adaptive-rate-limit/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-347` tag.
# Durable business rules xstockstrat-config already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-config — Alpaca adaptive rate limit kill switches are seeded

  @AC-37 @FR-6 @feature-347
  Scenario: The kill switches are seeded on and the ceiling description changes only when untouched
    Given the config migration "alpaca_adaptive_rate_limit_keys" is applied twice
    Then namespace "marketdata" key "alpaca.adaptive_rate_limit_enabled" and namespace "trading" key "broker.adaptive_rate_limit_enabled" each have exactly one global row in "staging" and one in "production" with value_type "bool" and value "true"
    And the seeded description of "backfill.rate_limit_rps" equals the new ceiling description text fixed in the implementation spec
    And a "backfill.rate_limit_rps" description edited by an operator is left unchanged
