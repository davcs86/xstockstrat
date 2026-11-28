# Promoted from docs/roadmap/features/345-authelia-sso/acceptance.feature (C-16).
Feature: authelia-sso (identity)

  Background:
    Given the issuer is "https://auth.example.test"
    And the staging AGENT_PUBLIC_URL is "https://xstockstrat-staging.example.test/agent"
    And the staging config holds ui/oidc.issuer and agent/oidc.issuer = "https://auth.example.test"
    And staging identity/auth.mode is "oidc" unless a scenario says otherwise

  @AC-16 @FR-9 @FR-14 @feature-345
  Scenario: Password login is refused in oidc mode
    Given staging identity/auth.mode is "oidc"
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns PERMISSION_DENIED with "password login disabled"
    And the staging login page shows the "Sign in with SSO" button and the "Keep me signed in for 14 days (SSO)" checkbox and no password field

  @AC-17 @FR-9 @FR-14 @feature-345
  Scenario: Both mode offers password and SSO
    Given staging identity/auth.mode is "both"
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns an access token and a refresh token
    And the staging login page shows both the password form and the "Sign in with SSO" button

  @AC-25 @FR-16 @feature-345
  Scenario: Two users linking the same subject at once yield one link
    Given staging identity/auth.mode is "both"
    When LinkExternalIdentity for subject "k1k2" is called for user "erin@example.test" and for user "fay@example.test" at the same moment, each with its correct password
    Then identity.external_identities holds exactly one row for subject "k1k2"
    And the other call is refused with FAILED_PRECONDITION "account already linked"

  @AC-27 @FR-4 @feature-345
  Scenario: Only the UI and the agent may call ResolveExternalIdentity
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-notify" and header x-access-scope "15"
    When it calls ResolveExternalIdentity for subject "a1b2"
    Then it receives PERMISSION_DENIED
    And no row in identity.users or identity.external_identities is read or written

  @AC-28 @FR-16 @feature-345
  Scenario: A ledger outage does not block a link
    Given staging identity/auth.mode is "both" and xstockstrat-ledger is unreachable
    And "gina@example.test" is signed in with a password
    When gina links SSO for subject "p5p6" and confirms with her correct password
    Then subject "p5p6" is linked to gina's user
    And identity logs the error "ledger audit append failed (best-effort)" and counts identity.audit.failures with event_type "identity.external.linked"

  @AC-31 @FR-9 @feature-345
  Scenario: A missing mode reads as local
    Given the staging config has no identity/auth.mode row
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns an access token and a refresh token
    And the login page shows the password form and no "Sign in with SSO" button

  @AC-38 @FR-4 @feature-345
  Scenario: Only the UI may mint sessions with IssueSessionForUser
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-agent"
    When it calls IssueSessionForUser for user_id "11111111-1111-4111-8111-111111111111"
    Then it receives PERMISSION_DENIED and no refresh token row is written

  @AC-70 @FR-4 @feature-345
  Scenario: Only the UI may call LinkExternalIdentity
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-agent"
    When it calls LinkExternalIdentity for user_id "11111111-1111-4111-8111-111111111111" and subject "a1b2"
    Then it receives PERMISSION_DENIED and no row in identity.external_identities is read or written

  @AC-73 @FR-4 @FR-16 @feature-345
  Scenario: Only the UI may call GetExternalIdentityLinks
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-agent"
    When it calls GetExternalIdentityLinks for user_id "11111111-1111-4111-8111-111111111111"
    Then it receives PERMISSION_DENIED and no row in identity.external_identities is read

  @AC-75 @FR-4 @FR-16 @feature-345
  Scenario Outline: Identity refuses a link outside both mode
    Given staging identity/auth.mode is "<mode>"
    When a client presenting mTLS peer SAN "xstockstrat-ui" calls LinkExternalIdentity for user_id "11111111-1111-4111-8111-111111111111", subject "a1b2" and that user's correct password
    Then it receives FAILED_PRECONDITION "link disabled"
    And no row in identity.users or identity.external_identities is read or written

    Examples:
      | mode  |
      | local |
      | oidc  |
