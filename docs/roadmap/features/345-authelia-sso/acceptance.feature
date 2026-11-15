Feature: authelia-sso
  As a platform admin, I want xstockstrat (prod and staging, web UI and MCP agent) to authenticate users through the
  homelab's Authelia while identity.users and per-environment roles stay authoritative, so family members get one
  login with passkey/TOTP 2FA and MCP connectors can be narrowed.

  Background:
    Given the Authelia issuer is "https://auth.example.test"
    And the staging agent's resource URI is "https://xstockstrat-staging.example.test/agent"

  @AC-1 @FR-1 @FR-3
  Scenario: Web login links an existing user by email and keeps their roles
    Given staging has an active, unlinked user "alice@example.test" with user_id "11111111-1111-4111-8111-111111111111" and roles ["admin","trader"]
    When Authelia completes a login for subject "a1b2" with email "Alice@Example.test" at the staging UI callback
    Then identity.external_identities holds ("https://auth.example.test", "a1b2") -> "11111111-1111-4111-8111-111111111111"
    And the session JWT carries user_id "11111111-1111-4111-8111-111111111111" and roles ["admin","trader"]
    And the ledger holds one audit event recording the link for that user_id

  @AC-2 @FR-3
  Scenario: A second login uses the existing link, not the email
    Given subject "a1b2" is linked to user_id "11111111-1111-4111-8111-111111111111" in staging
    When Authelia completes a login for subject "a1b2" with email "alice.new@example.test"
    Then ResolveExternalIdentity returns user_id "11111111-1111-4111-8111-111111111111" with outcome linked-existing
    And no new row is created in identity.users

  @AC-3 @FR-3
  Scenario: An unknown person gets a new trader account
    Given staging has no user with email "bob@example.test"
    When Authelia completes a login for subject "c3d4" with email "bob@example.test"
    Then identity.users holds a new active row with email "bob@example.test" and roles exactly ["trader"]
    And subject "c3d4" is linked to that row with outcome created

  @AC-4 @FR-3
  Scenario: An email already linked to another subject is refused
    Given staging user "carol@example.test" is linked to subject "e5f6"
    When Authelia completes a login for subject "z9z9" with email "carol@example.test"
    Then the login is refused with "account already linked"
    And no row in identity.users or identity.external_identities changes

  @AC-5 @FR-3
  Scenario: Two case-insensitive email matches are refused
    Given staging has unlinked users "dave@example.test" and "Dave@example.test"
    When Authelia completes a login for subject "g7h8" with email "dave@example.test"
    Then the login is refused with "ambiguous email"
    And no link is created

  @AC-6 @FR-3
  Scenario: Prod and staging resolve the same subject independently
    Given subject "a1b2" is linked to user_id "11111111-1111-4111-8111-111111111111" in staging only
    And production has an active, unlinked user "alice@example.test" with user_id "22222222-2222-4222-8222-222222222222" and roles ["viewer"]
    When Authelia completes a login for subject "a1b2" with email "alice@example.test" at the production UI callback
    Then production links subject "a1b2" to "22222222-2222-4222-8222-222222222222"
    And the production session JWT carries roles ["viewer"]

  @AC-7 @FR-3 @FR-7
  Scenario: A deactivated user is refused on web and MCP
    Given staging user "11111111-1111-4111-8111-111111111111" linked to subject "a1b2" has is_active false
    When subject "a1b2" logs in at the staging UI or calls the staging MCP endpoint with a valid token
    Then the UI login is refused and the MCP call returns HTTP 403

  @AC-8 @FR-4
  Scenario: The email from Authelia is copied into identity
    Given subject "a1b2" is linked to staging user "11111111-1111-4111-8111-111111111111" whose email is "alice@example.test"
    When Authelia completes a login for subject "a1b2" with email "alice@family.example.test"
    Then identity.users.email for that user is "alice@family.example.test"

  @AC-9 @FR-4
  Scenario: An email clash keeps the old email
    Given subject "a1b2" is linked to a staging user whose email is "alice@example.test"
    And another staging user holds "shared@example.test"
    When Authelia completes a login for subject "a1b2" with email "shared@example.test"
    Then the login succeeds and that user's email stays "alice@example.test"
    And a log entry records the email clash for subject "a1b2"

  @AC-10 @FR-2
  Scenario: A token for another resource is rejected
    Given a valid Authelia JWT access token whose aud is "https://webhooks-mcp.example.test/mcp"
    When it is sent to the staging agent's MCP endpoint
    Then the agent returns HTTP 401 with a WWW-Authenticate header pointing at its protected-resource metadata

  @AC-11 @FR-2
  Scenario: Protected-resource metadata names Authelia
    When a client fetches the staging agent's RFC 9728 protected-resource metadata
    Then "authorization_servers" is ["https://auth.example.test"]
    And "resource" is "https://xstockstrat-staging.example.test/agent"

  @AC-12 @FR-6
  Scenario: A read-only connector cannot trade or change config
    Given user roles ["trader"] (scope 11)
    And the token's scope is "xstockstrat.read"
    When the agent forwards a tool call
    Then x-access-scope is 1
    And the forwarded metadata carries neither the WRITE (0x02) nor the TRADING (0x08) bit

  @AC-13 @FR-6
  Scenario: A token cannot widen a user's roles
    Given user roles ["viewer"] (scope 1)
    And the token's scope is "xstockstrat.read xstockstrat.write xstockstrat.trade xstockstrat.admin"
    When the agent forwards a tool call
    Then x-access-scope is 1

  @AC-14 @FR-5 @FR-7
  Scenario: A role change reaches MCP within 60 seconds
    Given subject "a1b2" holds roles ["trader"] and has made an MCP call at 12:00:00
    When an admin sets the roles to ["viewer"] at 12:00:05
    Then an MCP call at 12:01:06 forwards x-access-scope 1

  @AC-15 @FR-7
  Scenario: Identity outage fails closed once the cache expires
    Given the agent cached subject "a1b2" at 12:00:00
    And xstockstrat-identity is unreachable from 12:00:30
    When subject "a1b2" calls a tool at 12:01:01
    Then the agent returns an error and no backend RPC is sent

  @AC-16 @FR-8
  Scenario: Password login is rejected when the flag is off
    Given identity.auth.password_login_enabled is false in staging
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns PERMISSION_DENIED with "password login disabled"
    And the staging login page shows only "Sign in with SSO"

  @AC-17 @FR-8
  Scenario: Password login works again when the flag is turned on
    Given identity.auth.password_login_enabled is true in staging
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns an access token and a refresh token

  @AC-18 @FR-9
  Scenario: update-email aligns a row with the Authelia email
    Given staging has user "admin@localhost"
    When an admin runs "uv run scripts/manage-users.py update-email admin@localhost alice@example.test"
    Then that row's email is "alice@example.test" and its user_id is unchanged

  @AC-19 @FR-9
  Scenario: update-email refuses an email held by another row
    Given staging has users "admin@localhost" and "Alice@example.test"
    When an admin runs "uv run scripts/manage-users.py update-email admin@localhost alice@example.test"
    Then the command exits non-zero with "email already in use"
    And no row changes

  @AC-20 @FR-10
  Scenario: MCP connector setup is documented
    When an operator reads docs/runbooks/mcp-tools.md
    Then it gives the pre-registered client IDs for the read-only and full connectors per environment
    And the redirect URI "https://claude.ai/api/mcp/auth_callback"
