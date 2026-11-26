# Promoted from docs/roadmap/features/319-fix-auth-trust-hardening/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-319` tag.
# Durable business rules xstockstrat-config already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-config - an internal-caller SetConfig grant is bound to the mTLS peer SAN
  Internal-caller config writes are authorized only from the mTLS peer the grant names, not from the x-internal-caller header alone.

  # guards: docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md
  @AC-1 @regression @feature-319
  Scenario: an internal-caller SetConfig from a peer without the trading SAN is denied
    Given an mTLS client whose platform-CA leaf DNS SAN is "xstockstrat-notify"
    When it calls SetConfig namespace "platform" key "trading_state" value "HALTED" with metadata x-internal-caller "trading-reconciliation-poller" and no admin x-access-scope
    Then the call fails with PERMISSION_DENIED
    And no config.config_audit row is written with changed_by "trading-reconciliation-poller"
    And the same call from a peer with DNS SAN "xstockstrat-trading" is authorized
