Feature: authelia-sso
  As a platform admin, I want xstockstrat (prod and staging, web UI and MCP agent) to authenticate users through the
  homelab's Authelia while identity.users and per-environment roles stay authoritative, so family members get one
  login with passkey/TOTP 2FA and MCP connectors can be narrowed.

  Background:
    Given the Authelia issuer is "https://auth.example.test"
    And the staging AGENT_PUBLIC_URL is "https://xstockstrat-staging.example.test/agent"
    And the staging config holds ui/oidc.issuer and agent/oidc.issuer = "https://auth.example.test"

  @AC-1 @FR-1 @FR-3
  Scenario: Web login links an existing user by email and keeps their roles
    Given staging has an active, unlinked user "alice@example.test" with user_id "11111111-1111-4111-8111-111111111111" and roles ["admin","trader"]
    When Authelia completes a login for subject "a1b2" with email "Alice@Example.test" at the staging UI callback
    Then the browser lands on "/trader" with a session whose user_id is "11111111-1111-4111-8111-111111111111" and roles are ["admin","trader"]
    And identity.external_identities holds ("https://auth.example.test", "a1b2") -> "11111111-1111-4111-8111-111111111111"
    And the ledger holds one "identity.external.linked" event for that user_id with outcome LINKED_BY_EMAIL and no email field

  @AC-2 @FR-3 @FR-5
  Scenario: A returning user is matched by subject and their new email is synced
    Given subject "a1b2" is linked to active staging user "11111111-1111-4111-8111-111111111111" whose email is "alice@example.test"
    When Authelia completes a login for subject "a1b2" with email "alice.new@example.test"
    Then the session user_id is "11111111-1111-4111-8111-111111111111"
    And identity.users still holds exactly one row for that person, now with email "alice.new@example.test"

  @AC-3 @FR-3
  Scenario: An unknown person gets a new trader account
    Given staging has no user with email "bob@example.test" in any state
    When Authelia completes a login for subject "c3d4" with email "Bob@Example.test"
    Then identity.users holds a new active row with email "bob@example.test" and roles exactly ["trader"]
    And subject "c3d4" is linked to that row

  @AC-4 @FR-3
  Scenario: An email already linked to another subject is refused
    Given staging user "carol@example.test" is linked to subject "e5f6"
    When Authelia completes a login for subject "z9z9" with email "carol@example.test"
    Then the login page shows "This account is already linked to another sign-in. Ask an admin." and no session cookie is set
    And no row in identity.users or identity.external_identities changes

  @AC-5 @FR-3
  Scenario: Two case-insensitive email matches are refused
    Given staging has unlinked users "dave@example.test" and "Dave@example.test"
    When Authelia completes a login for subject "g7h8" with email "dave@example.test"
    Then the login page shows "More than one account uses this email. Ask an admin." and no session cookie is set
    And no link is created

  @AC-6 @FR-3
  Scenario: Prod and staging resolve the same subject independently
    Given subject "a1b2" is linked to user_id "11111111-1111-4111-8111-111111111111" in staging only
    And production has an active, unlinked user "alice@example.test" with user_id "22222222-2222-4222-8222-222222222222" and roles ["viewer"]
    When Authelia completes a login for subject "a1b2" with email "alice@example.test" at the production UI callback
    Then production links subject "a1b2" to "22222222-2222-4222-8222-222222222222"
    And the production session carries roles ["viewer"]

  @AC-7 @FR-3
  Scenario: A deactivated linked user is refused at web login
    Given staging user "11111111-1111-4111-8111-111111111111" linked to subject "a1b2" has is_active false
    When Authelia completes a login for subject "a1b2" at the staging UI callback
    Then the login page shows "This account is disabled. Ask an admin." and no session cookie is set

  @AC-8 @FR-5
  Scenario: The email from Authelia is copied into identity
    Given subject "a1b2" is linked to staging user "11111111-1111-4111-8111-111111111111" whose email is "alice@example.test"
    When Authelia completes a login for subject "a1b2" with email "Alice@Family.example.test"
    Then identity.users.email for that user is "alice@family.example.test"

  @AC-9 @FR-5
  Scenario: An email clash keeps the old email
    Given subject "a1b2" is linked to a staging user whose email is "alice@example.test"
    And another staging user holds "Shared@example.test"
    When Authelia completes a login for subject "a1b2" with email "shared@example.test"
    Then the login succeeds and that user's email stays "alice@example.test"
    And identity logs one warn entry "email_sync_conflict" carrying that user_id and the issuer, with no email value

  @AC-10 @FR-2
  Scenario: A token for another resource is rejected
    Given a valid Authelia JWT access token whose aud is "https://webhooks-mcp.example.test/mcp"
    When it is sent to the staging agent's MCP endpoint
    Then the agent returns HTTP 401 with WWW-Authenticate resource_metadata "https://xstockstrat-staging.example.test/agent/.well-known/oauth-protected-resource"

  @AC-11 @FR-2
  Scenario: Protected-resource metadata names Authelia
    When a client fetches the staging agent's RFC 9728 protected-resource metadata
    Then "authorization_servers" is ["https://auth.example.test"]
    And "resource" is "https://xstockstrat-staging.example.test/agent"

  @AC-12 @FR-7
  Scenario: A read-only connector cannot trade or change config
    Given user roles ["trader"] (scope 11)
    And the token's scope is "xstockstrat.read"
    When the agent forwards a tool call
    Then x-access-scope is 1
    And the forwarded metadata carries neither the WRITE (0x02) nor the TRADING (0x08) bit

  @AC-13 @FR-7
  Scenario: A token cannot widen a user's roles
    Given user roles ["viewer"] (scope 1)
    And the token's scope is "xstockstrat.read xstockstrat.write xstockstrat.trade xstockstrat.admin"
    When the agent forwards a tool call
    Then x-access-scope is 1

  @AC-14 @FR-6 @FR-8
  Scenario: A role change reaches MCP within 60 seconds
    Given subject "a1b2" holds roles ["trader"] and has made an MCP call at 12:00:00
    When an admin sets the roles to ["viewer"] at 12:00:05
    Then an MCP call at 12:01:06 forwards x-access-scope 1

  @AC-15 @FR-8
  Scenario: Identity outage fails closed once the cache expires
    Given the agent cached subject "a1b2" at 12:00:00
    And xstockstrat-identity is unreachable from 12:00:30
    When subject "a1b2" calls a tool at 12:01:01
    Then the agent returns HTTP 503 and no backend RPC is sent

  @AC-16 @FR-9
  Scenario: Password login is rejected when the flag is off
    Given identity/auth.password_login_enabled is false in staging
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns PERMISSION_DENIED with "password login disabled"
    And the staging login page shows the "Sign in with SSO" button and the "Keep me signed in for 14 days (SSO)" checkbox and no password field

  @AC-17 @FR-9
  Scenario: Password login works again when the flag is turned on
    Given identity/auth.password_login_enabled is true in staging
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns an access token and a refresh token
    And the staging login page shows both the password form and the "Sign in with SSO" button

  @AC-18 @FR-12
  Scenario: update-email aligns a row with the Authelia email
    Given staging has user "admin@localhost" with user_id "33333333-3333-4333-8333-333333333333"
    When an admin runs "uv run scripts/manage-users.py update-email admin@localhost Alice@Example.test"
    Then that row's email is "alice@example.test" and its user_id is "33333333-3333-4333-8333-333333333333"

  @AC-19 @FR-12
  Scenario: update-email refuses an email held by another row
    Given staging has users "admin@localhost" and "Alice@example.test"
    When an admin runs "uv run scripts/manage-users.py update-email admin@localhost alice@example.test"
    Then the command exits non-zero with "email already in use"
    And no row changes

  @AC-20 @FR-13
  Scenario: MCP connector setup is documented
    When an operator reads docs/runbooks/mcp-tools.md
    Then it lists client IDs "xstockstrat-mcp-claude", "xstockstrat-mcp-claude-ro", "xstockstrat-staging-mcp-claude" and "xstockstrat-staging-mcp-claude-ro"
    And it gives the redirect URI "https://claude.ai/api/mcp/auth_callback"

  @AC-21 @FR-3 @FR-8
  Scenario: A deactivated linked user is refused on MCP
    Given staging user "11111111-1111-4111-8111-111111111111" linked to subject "a1b2" has is_active false
    And the agent holds no cached entry for subject "a1b2"
    When subject "a1b2" calls the staging MCP endpoint with a valid token
    Then the agent returns HTTP 403 and no backend RPC is sent

  @AC-22 @FR-2 @FR-7
  Scenario: A valid token runs the tool as the resolved xstockstrat user
    Given subject "a1b2" is linked to staging user "11111111-1111-4111-8111-111111111111" with roles ["trader"]
    And a valid Authelia JWT access token for subject "a1b2" with aud "https://xstockstrat-staging.example.test/agent" and scope "xstockstrat.read xstockstrat.write"
    When it calls the list_strategies tool
    Then the tool returns a result
    And the backend call carries x-user-id "11111111-1111-4111-8111-111111111111" (never "a1b2") and x-access-scope 3

  @AC-23 @FR-2
  Scenario Outline: An invalid Authelia token is rejected
    Given an Authelia JWT access token for the staging agent that <defect>
    When it is sent to the staging MCP endpoint
    Then the agent returns HTTP 401 and no backend RPC is sent

    Examples:
      | defect                                          |
      | has iss "https://evil.example.test"             |
      | expired at 11:59:59 for a call at 12:00:00      |
      | has a signature not made by any key in the JWKS |
      | was minted by xstockstrat-identity (HS256)      |

  @AC-24 @FR-1
  Scenario Outline: A tampered web login callback creates no session
    Given a staging login started with state "s-123" and nonce "n-456"
    When the callback arrives with <tamper>
    Then the login page shows "Sign-in failed. Try again." and no session cookie is set
    And ResolveExternalIdentity is not called

    Examples:
      | tamper                                   |
      | state "s-999"                            |
      | an ID token whose nonce is "n-000"       |
      | an ID token whose aud is "other-client"  |
      | an ID token signed by a key not in Authelia's JWKS |

  @AC-25 @FR-3
  Scenario: Concurrent first logins create one account
    Given staging has no user with email "erin@example.test"
    When two callbacks for subject "k1k2" with email "erin@example.test" resolve at the same moment
    Then identity.users holds exactly one row with email "erin@example.test"
    And identity.external_identities holds exactly one row for subject "k1k2"
    And both logins end with a session for that same user_id

  @AC-26 @FR-3
  Scenario: An inactive unlinked email match is refused, not duplicated
    Given staging has an inactive, unlinked user "frank@example.test"
    When Authelia completes a login for subject "m3m4" with email "frank@example.test"
    Then the login page shows "This account is disabled. Ask an admin." and no session cookie is set
    And no new row is created in identity.users

  @AC-27 @FR-4
  Scenario: Only the UI and the agent may call ResolveExternalIdentity
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-notify" and header x-access-scope "15"
    When it calls ResolveExternalIdentity for subject "a1b2" and email "alice@example.test"
    Then it receives PERMISSION_DENIED
    And no row in identity.users or identity.external_identities is read or written

  @AC-28 @FR-3
  Scenario: A ledger outage does not block a first login
    Given xstockstrat-ledger is unreachable
    And staging has an active, unlinked user "gina@example.test"
    When Authelia completes a login for subject "p5p6" with email "gina@example.test"
    Then the login succeeds and subject "p5p6" is linked to that user
    And identity logs a failed-audit warning for "identity.external.linked"

  @AC-29 @FR-1
  Scenario: Remember me survives the SSO round trip
    Given the user ticks "Keep me signed in for 14 days (SSO)" and clicks "Sign in with SSO" on the staging login page
    When Authelia completes the login for subject "a1b2"
    Then the session cookies carry Max-Age=1209600 and the "remember_me=1" marker is set
    And a later cookie rotation keeps Max-Age=1209600

  @AC-30 @FR-2 @FR-7
  Scenario: The first MCP use links by email like the web
    Given staging has an active, unlinked user "hana@example.test" with roles ["viewer"]
    And no web login has happened for subject "q7q8"
    When subject "q7q8" calls a tool with a valid token carrying email "hana@example.test" and scope "xstockstrat.read"
    Then subject "q7q8" is linked to that user and the backend call carries x-access-scope 1

  @AC-31 @FR-9
  Scenario: A missing password flag fails closed
    Given the staging config has no identity/auth.password_login_enabled row
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns PERMISSION_DENIED with "password login disabled"

  @AC-32 @FR-1 @FR-14
  Scenario: A half-configured deployment stays in legacy mode
    Given staging ui/oidc.issuer is "https://auth.example.test" and agent/oidc.issuer is ""
    When the UI and the agent start
    Then the login page shows the password form and no "Sign in with SSO" button
    And MCP accepts an identity-minted token whose aud is "https://xstockstrat-staging.example.test/agent"
    And both services log "sso_mode_misconfigured" once

  @AC-33 @FR-10
  Scenario: Deactivation ends a web session at the next refresh
    Given subject "a1b2" holds a staging web session for user "11111111-1111-4111-8111-111111111111"
    When an admin runs SetUserActive false for that user and the UI then refreshes the session
    Then the refresh is refused and the browser is sent to the login page

  @AC-34 @FR-11
  Scenario: Authorized apps points to Authelia
    When a signed-in user opens "/accounts/authorized-apps" in staging
    Then the page shows a link to "https://auth.example.test" for managing connected apps
    And it lists no xstockstrat OAuth grants and offers no revoke button

  @AC-35 @FR-1
  Scenario: Only the UI can read the OIDC client secret
    Given staging ui/oidc.client_secret is an encrypted is_secret row
    When GetSecret for namespace "ui" key "oidc.client_secret" is called by peer SAN "xstockstrat-ui" and by peer SAN "xstockstrat-agent"
    Then the UI receives the decrypted value and the agent receives PERMISSION_DENIED
    And GetConfig and WatchConfig return the row redacted

  @AC-36 @FR-13
  Scenario: The seed-owner rule is documented
    When an engineer reads IDENTITY-15 in services/xstockstrat-identity/docs/context-constitution.md
    Then it states that admin@localhost may be renamed by SSO cutover and that new migrations resolve the seed owner by SEED_USER_ID
    And AGENT-9 in services/xstockstrat-agent/docs/context-constitution.md lists "agent", "indicators" and "ui" as the watched namespaces

  @AC-37 @FR-3 @FR-8
  Scenario: An ambiguous email is refused on MCP
    Given staging has unlinked users "ivan@example.test" and "Ivan@example.test"
    When subject "r9r9" calls the staging MCP endpoint with a valid token carrying email "ivan@example.test"
    Then the agent returns HTTP 403 and no backend RPC is sent
    And no link is created

  @AC-38 @FR-4
  Scenario: Only the UI may mint sessions with IssueSessionForUser
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-agent"
    When it calls IssueSessionForUser for user_id "11111111-1111-4111-8111-111111111111"
    Then it receives PERMISSION_DENIED and no refresh token row is written

  @AC-39 @FR-3
  Scenario: A web login without an email is refused for an unlinked subject
    Given subject "t1t2" is not linked in staging
    When Authelia completes a login for subject "t1t2" whose ID token has no email claim
    Then the login page shows "Your sign-in has no email. Ask an admin." and no session cookie is set
    And no row is created in identity.users

  @AC-40 @FR-3 @FR-8
  Scenario: An MCP token without an email is refused for an unlinked subject
    Given subject "u3u4" is not linked in staging
    When it calls the staging MCP endpoint with a valid token whose email claim is ""
    Then the agent returns HTTP 403, no backend RPC is sent and no row is created in identity.users

  @AC-41 @FR-14
  Scenario: A DigitalOcean deployment behaves as before this feature
    Given the DigitalOcean dev app's config has ui/oidc.issuer "" and agent/oidc.issuer "" and identity/auth.password_login_enabled true
    When a user signs in with email "admin@localhost" and the correct password on the login page
    Then the browser lands on "/trader" with a session for that user
    And the login page shows no "Sign in with SSO" button

  @AC-42 @FR-14
  Scenario: Legacy-mode MCP keeps the built-in OAuth server
    Given the DigitalOcean dev app's agent/oidc.issuer is ""
    When Claude registers at "/agent/oauth/register", completes "/agent/oauth/authorize" and exchanges the code at "/agent/oauth/token"
    Then the identity-minted access token is accepted on the MCP endpoint and list_strategies returns a result
    And "/accounts/authorized-apps" lists that grant with a revoke button

  @AC-43 @FR-14 @FR-2
  Scenario: SSO mode rejects legacy tokens and routes
    Given staging is in SSO mode
    When a client calls "/agent/oauth/register" or sends an identity-minted token to the MCP endpoint
    Then the register call returns HTTP 404 and the MCP call returns HTTP 401

  @AC-44 @FR-14
  Scenario: Clearing the issuers rolls a deployment back to legacy mode
    Given staging is in SSO mode
    When an operator sets ui/oidc.issuer and agent/oidc.issuer to "" and identity/auth.password_login_enabled to true
    Then the next login page render shows the password form and no "Sign in with SSO" button
    And within 60 seconds MCP accepts identity-minted tokens again

  @AC-45 @FR-9 @FR-14
  Scenario: Legacy mode never hides the password form
    Given the DigitalOcean dev app's ui/oidc.issuer is "" and identity/auth.password_login_enabled is false
    When a user opens the login page
    Then the page shows the password form and the banner "Password login is disabled in config (identity/auth.password_login_enabled) while SSO is not configured. Ask an admin."
    And submitting email "admin@localhost" with the correct password shows "password login disabled"

  @AC-46 @FR-9 @FR-14
  Scenario: An unreadable config renders the legacy login
    Given xstockstrat-config is unreachable from the UI
    When a user opens the login page
    Then the page shows the password form and no "Sign in with SSO" button

  @AC-47 @FR-14
  Scenario: The SSO routes are inert outside SSO mode
    Given staging ui/oidc.issuer is "https://auth.example.test" and agent/oidc.issuer is ""
    When a client POSTs "/api/auth/sso/start" from the same origin and GETs "/api/auth/sso/callback?code=c1&state=s1"
    Then both return HTTP 404 with no redirect
    And no row is written to identity.users or identity.external_identities

  @AC-48 @FR-11
  Scenario: The authorized-apps card shows the connector details in SSO mode
    Given staging ui/oidc.mcp_client_id is "xstockstrat-staging-mcp-claude" and ui/oidc.mcp_client_id_readonly is "xstockstrat-staging-mcp-claude-ro"
    When a signed-in user opens "/accounts/authorized-apps" in staging
    Then the page shows the connector URL "https://xstockstrat-staging.example.test/agent" with a copy button
    And it shows the client IDs "xstockstrat-staging-mcp-claude" and "xstockstrat-staging-mcp-claude-ro"

  @AC-49 @FR-11 @FR-2
  Scenario: The UI's discovery documents follow the mode
    When a client fetches "/.well-known/oauth-protected-resource/agent" and "/.well-known/oauth-authorization-server/agent" from the staging UI
    Then the first lists "authorization_servers" ["https://auth.example.test"]
    And the second returns HTTP 404

  @AC-50 @FR-12
  Scenario: unlink-sso lets a user relink after Authelia identities change
    Given staging user "alice@example.test" is linked to subject "a1b2"
    When an admin runs "uv run scripts/manage-users.py unlink-sso alice@example.test"
    Then identity.external_identities has no row for that user
    And Authelia completing a login for subject "n3w0" with email "alice@example.test" links that user with outcome LINKED_BY_EMAIL

  @AC-51 @FR-15
  Scenario: A person outside the app's group sees a no-access message
    Given Authelia answers the staging authorization request with error "access_denied"
    When the browser arrives at the staging SSO callback
    Then the login page shows "You don't have access to xstockstrat. Ask an admin." and no session cookie is set

  @AC-52 @FR-15
  Scenario: Logout ends the Authelia session when Authelia supports it
    Given staging is in SSO mode and Authelia's discovery document advertises an end_session_endpoint
    When a signed-in user logs out
    Then the session cookies are cleared and the refresh token is revoked
    And the browser is redirected to that end_session_endpoint with post_logout_redirect_uri "https://xstockstrat-staging.example.test/auth/login"

  @AC-53 @FR-15
  Scenario: Logout falls back to Authelia's portal logout
    Given staging is in SSO mode and Authelia's discovery document advertises no end_session_endpoint
    When a signed-in user logs out
    Then the session cookies are cleared and the refresh token is revoked
    And the browser is redirected to Authelia's portal logout with a return address of "https://xstockstrat-staging.example.test/auth/login"
