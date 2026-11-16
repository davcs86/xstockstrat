# Promoted from docs/roadmap/features/338-notify-commsgun-channel/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-338` tag.
# Durable business rules the ui service already guarantees — do not hand-edit to document new
# behavior; a rule enters only by promotion from a reviewed feature acceptance.feature.

Feature: xstockstrat-ui - config-ui lists, masks and saves the notify commsgun keys
  As the platform operator, I operate the commsgun email provider from config-ui's key editor.


  @AC-16 @FR-10 @feature-338
  Scenario: the new keys are seeded and editable in config-ui
    Given a database migrated to the latest config migration
    When an admin opens "/config-ui" and filters the namespace "notify"
    Then "fanout.email_provider" is listed with value "auto"
    And "commsgun.app_key" is listed as a secret whose wire value is "[redacted]" and which the page shows as "[secret]"
    And saving "fanout.email_provider" as "sendgrid" persists and is shown after a reload
