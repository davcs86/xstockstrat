# Promoted from docs/roadmap/features/338-notify-commsgun-channel/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-338` tag.
# Durable business rules the config service already guarantees — do not hand-edit to document new
# behavior; a rule enters only by promotion from a reviewed feature acceptance.feature.

Feature: xstockstrat-config - the notify commsgun app key is a redacted secret only notify may resolve
  As the platform operator, the commsgun app key is stored encrypted, never shown at a read edge, and
  handed only to the notify service.


  @AC-14 @FR-9 @feature-338
  Scenario: the app key is resolved through GetSecret and redacted everywhere else
    Given the secret "notify" / "commsgun.app_key" is stored with value "k-0123456789abcdef0123456789abcdef"
    When GetConfig, ListKeys and WatchConfig return that key
    Then each returns the value "[redacted]"
    And GetSecret called with x-internal-caller "notify" returns "k-0123456789abcdef0123456789abcdef"
    And GetSecret called with x-internal-caller "analysis" for that key is refused with PERMISSION_DENIED
