Feature: fix-auth-trust-hardening (bug fix)
  Regression guard for clustered defect reports: internal-caller config writes are bound to the mTLS peer, token
  revocation acts only on genuinely signed tokens, and DCR does not widen registration during a config outage.

  # guards: docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md
  @AC-1 @regression
  Scenario: an internal-caller SetConfig from a peer without the trading SAN is denied
    Given an mTLS client whose platform-CA leaf DNS SAN is "xstockstrat-notify"
    When it calls SetConfig namespace "platform" key "trading_state" value "HALTED" with metadata x-internal-caller "trading-reconciliation-poller" and no admin x-access-scope
    Then the call fails with PERMISSION_DENIED
    And no config.config_audit row is written with changed_by "trading-reconciliation-poller"
    And the same call from a peer with DNS SAN "xstockstrat-trading" is authorized

  # guards: docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md
  @AC-2 @regression
  Scenario: RevokeToken with an unsigned token revokes nothing
    Given user "victim-1" has two active identity.refresh_tokens rows
    When IdentityService.RevokeToken is called with an unsigned JWT whose payload is {"user_id":"victim-1"}
    Then both refresh_tokens rows for "victim-1" still have revoked_at NULL
    And RevokeToken with an expired but correctly signed token for "victim-1" sets revoked_at on both rows

  # guards: docs/reports/2026-10-29-agent-dcr-fail-closed-defect.md
  # Pending Open Question 1 (operator security-posture decision); written for fail-closed.
  @AC-3 @regression
  Scenario: DCR is refused while the registration policy cannot be read
    Given agent.oauth.registration_enabled is "false"
    And the agent's read of the registration policy fails (no config snapshot for namespace "agent")
    When POST /oauth/register is sent with {"redirect_uris": ["https://attacker.example/cb"]}
    Then the response status is 503
    And no client_id is issued
