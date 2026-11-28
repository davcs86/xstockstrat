# Promoted from docs/roadmap/features/345-authelia-sso/acceptance.feature (C-16).
Feature: authelia-sso (config)

  Background:
    Given the issuer is "https://auth.example.test"
    And the staging AGENT_PUBLIC_URL is "https://xstockstrat-staging.example.test/agent"
    And the staging config holds ui/oidc.issuer and agent/oidc.issuer = "https://auth.example.test"
    And staging identity/auth.mode is "oidc" unless a scenario says otherwise

  @AC-35 @FR-4 @FR-14 @feature-345
  Scenario: Only the UI can read the OIDC client secret
    Given staging ui/oidc.client_secret is an encrypted is_secret row
    When GetSecret for namespace "ui" key "oidc.client_secret" is called with header x-internal-caller "ui" by peer SAN "xstockstrat-ui" and by peer SAN "xstockstrat-agent"
    Then the UI receives the decrypted value and the agent receives PERMISSION_DENIED
    And GetConfig and WatchConfig return the row redacted
