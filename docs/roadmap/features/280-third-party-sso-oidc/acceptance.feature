Feature: third-party-sso-oidc
  As an operator or trader whose organization runs an OIDC identity provider (e.g. Authentik),
  I want to sign in to xstockstrat through that provider, so that identity, MFA and offboarding
  are governed centrally while xstockstrat keeps issuing its own platform JWTs.

  @AC-1 @FR-1
  Scenario: Begin-SSO returns a PKCE authorization URL from discovery
    Given identity.sso.enabled is true and identity.sso.issuer_url is "https://auth.example.com/application/o/xstockstrat/"
    And the issuer's discovery document lists authorization_endpoint "https://auth.example.com/application/o/authorize/"
    When a client calls begin-SSO with return target "/trader"
    Then the response URL starts with "https://auth.example.com/application/o/authorize/"
    And its query contains response_type "code", code_challenge_method "S256", a non-empty state, and a non-empty nonce

  @AC-2 @FR-1 @FR-8
  Scenario: SSO disabled by default
    Given identity.sso.enabled is false
    When a client calls begin-SSO
    Then the call fails with FAILED_PRECONDITION "sso disabled"
    And AuthenticateUser with admin@example.com and the correct password still returns an access token

  @AC-3 @FR-2
  Scenario Outline: ID token validation failures are rejected
    Given a callback with a valid code and state
    And the ID token fails validation because of <defect>
    When complete-SSO is called
    Then it fails with UNAUTHENTICATED "sso login failed"
    And no access token or refresh token is issued

    Examples:
      | defect                              |
      | a signature not in the provider JWKS |
      | iss "https://evil.example.com"      |
      | aud "other-client"                  |
      | exp 1 hour in the past              |
      | nonce differing from the one issued |
      | email_verified false                |

  @AC-4 @FR-2
  Scenario: Tampered or replayed state is rejected
    Given a state value whose signature has been altered by one character
    When complete-SSO is called with it
    Then it fails with UNAUTHENTICATED "sso login failed"

  @AC-5 @FR-3
  Scenario: First SSO login links an existing user by verified email
    Given an active user "trader@example.com" with no SSO link
    And the IdP asserts email "trader@example.com", email_verified true, sub "ak-7f3a"
    When complete-SSO succeeds
    Then identity.user_sso_links has one row for that user with issuer "https://auth.example.com/application/o/xstockstrat/" and subject "ak-7f3a"
    And the response carries an access token whose sub claim is that user's id

  @AC-6 @FR-3
  Scenario: Later logins match on issuer and subject, not email
    Given user "trader@example.com" is linked to subject "ak-7f3a"
    And the IdP now asserts email "renamed@example.com" for subject "ak-7f3a"
    When complete-SSO succeeds
    Then the access token's sub claim is the same user id as before

  @AC-7 @FR-3
  Scenario: Unknown email is not auto-provisioned
    Given no user with email "stranger@example.com" exists
    And the IdP asserts email "stranger@example.com", email_verified true
    When complete-SSO is called
    Then it fails with UNAUTHENTICATED "sso login failed"
    And identity.users contains no row for "stranger@example.com"

  @AC-8 @FR-3
  Scenario: Deactivated user is denied
    Given a linked user whose active flag is false
    When complete-SSO is called with a valid ID token for that subject
    Then it fails with UNAUTHENTICATED "sso login failed"

  @AC-9 @FR-4
  Scenario: SSO tokens are indistinguishable in shape from password tokens
    Given user "trader@example.com" with roles ["user"]
    When the user signs in via SSO and, separately, via password
    Then both access tokens carry the same claim names, an expiry of 900 seconds, and ValidateToken accepts both

  @AC-10 @FR-5
  Scenario: Admin group grants admin role
    Given identity.sso.admin_group is "xstockstrat-admins" and groups_claim is "groups"
    And the ID token groups claim is ["staff", "xstockstrat-admins"]
    When a user with roles ["user"] completes SSO
    Then the issued token's roles include "admin"

  @AC-11 @FR-5
  Scenario: Leaving the admin group revokes only the SSO-granted admin
    Given a user whose admin role was granted by SSO and who also has a locally granted role "analyst"
    And the ID token groups claim is ["staff"]
    When the user completes SSO
    Then the issued token's roles do not include "admin"
    And still include "analyst"

  @AC-12 @FR-5
  Scenario: Group mapping inert when unconfigured
    Given identity.sso.admin_group is empty
    And the ID token groups claim is ["xstockstrat-admins"]
    When a user with roles ["user"] completes SSO
    Then the issued token's roles are ["user"]

  @AC-13 @FR-6
  Scenario: Login page shows the SSO control only when enabled
    Given identity.sso.enabled is true and identity.sso.button_label is "Sign in with Authentik"
    When an unauthenticated visitor opens /trader/login
    Then a button labelled "Sign in with Authentik" is visible
    And the username and password form is also visible

  @AC-14 @FR-6
  Scenario: Callback sets the session cookie and lands on the requested page
    Given the visitor started SSO from /insights/login with return target "/insights/backtests"
    When the IdP redirects to the callback with a valid code and state
    Then the response sets the segment's access-token cookie
    And redirects to "/insights/backtests"

  @AC-15 @FR-7
  Scenario: Agent authorize step authenticates the human via the IdP
    Given an MCP client has started the OAuth 2.1 authorize flow with a valid PKCE challenge
    When the human signs in at the IdP and returns to the agent
    Then the agent issues an authorization code bound to the SSO-authenticated user's id
    And the pre-login txn blob contains no user id or roles

  @AC-16 @FR-7
  Scenario: Forged txn cannot assert identity
    Given a txn blob signed before authentication with a client-supplied user id "attacker-id"
    When the agent callback is invoked without a validated IdP code
    Then no authorization code is issued

  @AC-17 @FR-8
  Scenario: Password login unchanged with SSO enabled
    Given identity.sso.enabled is true
    When AuthenticateUser is called with valid credentials for "trader@example.com"
    Then it returns access and refresh tokens as before

  @AC-18 @FR-9
  Scenario: Config-ui test connection reports discovery success and failure
    Given an admin on /config-ui/sso
    When they press "Test connection" with issuer_url reachable and serving a JWKS with 2 keys
    Then the page shows "Discovery OK" and "2 signing keys"
    When the issuer_url is "https://unreachable.invalid/"
    Then the page shows a failure reason and no stack trace

  @AC-19 @FR-9
  Scenario: Non-admin cannot read or test SSO settings
    Given a signed-in user with roles ["user"]
    When they call get-SSO-settings or test-SSO
    Then the call fails with PERMISSION_DENIED

  @AC-20 @FR-10
  Scenario: Client secret never leaves the config boundary
    Given identity.sso.client_secret is stored with is_secret true
    When an admin opens /config-ui/sso, calls GetConfig, and reads identity service logs for a full login
    Then the secret value appears in none of them and the field shows "[redacted]"

  @AC-21 @FR-11
  Scenario: Success and denial are audited without credentials
    Given an SSO login succeeds for "trader@example.com" and another is denied for "stranger@example.com"
    When the ledger is queried for sso events
    Then it contains one "auth.sso.success" and one "auth.sso.denied" event
    And neither payload contains a token, code, or client secret
