# Promoted from docs/roadmap/features/219-config-ui-usability/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-219` tag.
# Durable business rules the config service already guarantees — do not hand-edit to document new
# behavior; a rule enters only by promotion from a reviewed feature acceptance.feature.

Feature: xstockstrat-config — ListKeys last-updated time
  What the config service guarantees about the updated_at it returns from ListKeys, per scope,
  including for redacted secret rows.

  @AC-6 @FR-4 @feature-219
  Scenario: ListKeys returns the per-user row's updated_at in user scope
    Given a global row "platform.trading_state" in staging with updated_at "2026-09-01T10:00:00Z"
    And a per-user row "platform.trading_state" for user "u-123" in staging with updated_at "2026-09-15T08:30:00Z"
    When ListKeys is called with namespace "platform", environment STAGING, user_id "u-123"
    Then the "platform.trading_state" entry has updated_at "2026-09-15T08:30:00Z"

  @AC-7 @FR-4 @feature-219
  Scenario: Secret rows still expose no value but do carry updated_at
    Given a secret row "marketdata.alpaca.api_key" with updated_at "2026-09-20T12:00:00Z"
    When ListKeys is called for namespace "marketdata"
    Then the entry has current_value "[redacted]"
    And the entry has updated_at "2026-09-20T12:00:00Z"

  @AC-13 @FR-4 @feature-219
  Scenario: ListKeys returns the global row's updated_at in global scope
    Given a global row "platform.trading_state" in staging with updated_at "2026-09-01T10:00:00Z"
    And a per-user row "platform.trading_state" for user "u-123" in staging with updated_at "2026-09-15T08:30:00Z"
    When ListKeys is called with namespace "platform", environment STAGING, user_id ""
    Then the "platform.trading_state" entry has updated_at "2026-09-01T10:00:00Z"
