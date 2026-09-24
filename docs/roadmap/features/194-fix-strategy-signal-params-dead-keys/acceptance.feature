Feature: fix-strategy-signal-params-dead-keys (bug fix)
  Regression guard for Defect 1 of
  docs/reports/2026-09-18-deprecated-fields-in-rpc-contracts-defect.md:
  a served StrategyDefinition must not carry the dead feature-097 blend keys, must keep the
  load-bearing signal_params keys, and stripping them must never invalidate a strategy's scoring
  fingerprint (accumulated evidence grade).

  @AC-1 @regression
  Scenario: served payloads drop the dead blend keys but keep the load-bearing ones
    Given a stored strategy whose signal_params carries signal_sources, signal_weight, technical_weight, min_conviction, symbols, target and stop
    When GetStrategy (or ListStrategyDefinitions) serves that strategy
    Then the payload's signal_params contains only symbols, target and stop
    And it contains none of signal_sources, signal_weight, technical_weight, min_conviction

  @AC-2 @regression
  Scenario: a rename of an existing dirty strategy does not change its fingerprint
    Given a stored strategy whose signal_params still carries the dead blend keys
    When the strategy is updated with an update_mask naming only display_name
    Then the persisted definition_json is not re-keyed by the strip
    And the strategy's scoring fingerprint is unchanged (its evidence grade survives)
