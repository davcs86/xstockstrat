Feature: authelia-sso
  As a platform admin, I want each xstockstrat deployment (web UI and MCP agent) to authenticate users through an
  external OIDC issuer chosen by one config key, while identity.users and per-environment roles stay authoritative,
  every user keeps a local password and an SSO identity reaches an account only through an explicit "Link SSO".

  # Amended 2026-11-24 (owner re-spec, context.md). Retired IDs, never reused: AC-5, AC-8, AC-9, AC-18, AC-19,
  # AC-26, AC-37, AC-39, AC-40 (email linking, user creation, email sync and update-email are out of scope).
  # Changed meaning, same ID: AC-1, AC-2, AC-3, AC-4, AC-6, AC-16, AC-17, AC-25, AC-28, AC-30, AC-31, AC-32, AC-36,
  # AC-41, AC-44, AC-45, AC-47, AC-50, AC-21, AC-35, AC-46, AC-65, AC-69 (no RED test cites them yet).
  # Added 2026-11-24: AC-73..AC-78.

  Background:
    Given the issuer is "https://auth.example.test"
    And the staging AGENT_PUBLIC_URL is "https://xstockstrat-staging.example.test/agent"
    And the staging config holds ui/oidc.issuer and agent/oidc.issuer = "https://auth.example.test"
    And staging identity/auth.mode is "oidc" unless a scenario says otherwise

  @AC-1 @FR-1 @FR-3
  Scenario: Web login resolves a linked user and keeps their roles
    Given subject "a1b2" is linked to active staging user "11111111-1111-4111-8111-111111111111" with roles ["admin","trader"]
    When the issuer completes a login for subject "a1b2" at the staging UI callback
    Then the browser lands on "/trader" with a session whose user_id is "11111111-1111-4111-8111-111111111111" and roles are ["admin","trader"]

  @AC-2 @FR-3
  Scenario: A login never changes the user store
    Given subject "a1b2" is linked to active staging user "11111111-1111-4111-8111-111111111111" whose email is "alice@example.test"
    When the issuer completes a login for subject "a1b2" whose ID token's email is "alice.new@example.test"
    Then the session user_id is "11111111-1111-4111-8111-111111111111"
    And no row in identity.users or identity.external_identities changes

  @AC-3 @FR-1 @FR-3
  Scenario Outline: An unlinked person is refused and nothing is created
    Given staging identity/auth.mode is "<mode>"
    And subject "c3d4" is not linked in staging, and staging has an active user whose email is "bob@example.test"
    When the issuer completes a login for subject "c3d4" whose ID token's email is "bob@example.test"
    Then the login page shows "<message>" and no session cookie is set
    And no row in identity.users or identity.external_identities is written

    Examples:
      | mode | message                                                                                                                        |
      | both | Your single sign-on account isn't linked to an xstockstrat account. Sign in with your password and choose Link SSO, or ask an admin. |
      | oidc | Your single sign-on account isn't linked to an xstockstrat account. Ask an admin.                                              |

  @AC-4 @FR-16
  Scenario: A subject already linked to another user cannot be linked again
    Given staging identity/auth.mode is "both"
    And subject "e5f6" is linked to staging user "carol@example.test"
    And "dave@example.test" is signed in with a password
    When dave links SSO, the issuer returns subject "e5f6" and dave confirms with his correct password
    Then the account page shows "This sign-in is already linked to another account. Ask an admin."
    And no row in identity.external_identities changes

  @AC-6 @FR-3
  Scenario: Prod and staging links are independent
    Given subject "a1b2" is linked to user_id "11111111-1111-4111-8111-111111111111" in staging only
    And production identity/auth.mode is "oidc"
    When the issuer completes a login for subject "a1b2" at the production UI callback
    Then the production login page shows the "isn't linked" message and no session cookie is set
    And production identity.external_identities is unchanged

  @AC-7 @FR-3
  Scenario: A deactivated linked user is refused at web login
    Given staging user "11111111-1111-4111-8111-111111111111" linked to subject "a1b2" has is_active false
    When the issuer completes a login for subject "a1b2" at the staging UI callback
    Then the login page shows "This account is disabled. Ask an admin." and no session cookie is set

  @AC-10 @FR-2
  Scenario: A token for another resource is rejected
    Given a valid issuer JWT access token whose aud is "https://webhooks-mcp.example.test/mcp"
    When it is sent to the staging agent's MCP endpoint
    Then the agent returns HTTP 401 with WWW-Authenticate resource_metadata "https://xstockstrat-staging.example.test/agent/.well-known/oauth-protected-resource"

  @AC-11 @FR-2
  Scenario: Protected-resource metadata names the issuer
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

  @AC-16 @FR-9 @FR-14
  Scenario: Password login is refused in oidc mode
    Given staging identity/auth.mode is "oidc"
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns PERMISSION_DENIED with "password login disabled"
    And the staging login page shows the "Sign in with SSO" button and the "Keep me signed in for 14 days (SSO)" checkbox and no password field

  @AC-17 @FR-9 @FR-14
  Scenario: Both mode offers password and SSO
    Given staging identity/auth.mode is "both"
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns an access token and a refresh token
    And the staging login page shows both the password form and the "Sign in with SSO" button

  @AC-20 @FR-13
  Scenario: MCP connector setup is documented
    When an operator reads docs/runbooks/mcp-tools.md
    Then it lists client IDs "xstockstrat-mcp-claude", "xstockstrat-mcp-claude-ro", "xstockstrat-mcp-claude-code" and "xstockstrat-mcp-claude-code-ro", and the same four with the "xstockstrat-staging-" prefix
    And it gives the redirect URIs "https://claude.ai/api/mcp/auth_callback" and "https://claude.com/api/mcp/auth_callback" and the Claude Code loopback redirect
    And the runbook it links describes cutover (local, both, link, oidc), rollback and break-glass with the FR-17 command, Link SSO and unlink-sso

  @AC-21 @FR-3 @FR-8
  Scenario: A deactivated linked user is refused on MCP
    Given staging user "11111111-1111-4111-8111-111111111111" linked to subject "a1b2" has is_active false
    And the agent holds no cached entry for subject "a1b2"
    When subject "a1b2" calls the staging MCP endpoint with a valid token
    Then the agent returns HTTP 403 with the text/plain body "account inactive" and no backend RPC is sent

  @AC-22 @FR-2 @FR-7
  Scenario: A valid token runs the tool as the resolved xstockstrat user
    Given subject "a1b2" is linked to staging user "11111111-1111-4111-8111-111111111111" with roles ["trader"]
    And a valid issuer JWT access token for subject "a1b2" with aud "https://xstockstrat-staging.example.test/agent" and scope "xstockstrat.read xstockstrat.write"
    When it calls the list_strategies tool
    Then the tool returns a result
    And the backend call carries x-user-id "11111111-1111-4111-8111-111111111111" (never "a1b2") and x-access-scope 3

  @AC-23 @FR-2
  Scenario Outline: An invalid issuer token is rejected
    Given an issuer JWT access token for the staging agent that <defect>
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
      | an ID token signed by a key not in the issuer's JWKS |

  @AC-25 @FR-16
  Scenario: Two users linking the same subject at once yield one link
    Given staging identity/auth.mode is "both"
    When LinkExternalIdentity for subject "k1k2" is called for user "erin@example.test" and for user "fay@example.test" at the same moment, each with its correct password
    Then identity.external_identities holds exactly one row for subject "k1k2"
    And the other call is refused with FAILED_PRECONDITION "account already linked"

  @AC-27 @FR-4
  Scenario: Only the UI and the agent may call ResolveExternalIdentity
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-notify" and header x-access-scope "15"
    When it calls ResolveExternalIdentity for subject "a1b2"
    Then it receives PERMISSION_DENIED
    And no row in identity.users or identity.external_identities is read or written

  @AC-28 @FR-16
  Scenario: A ledger outage does not block a link
    Given staging identity/auth.mode is "both" and xstockstrat-ledger is unreachable
    And "gina@example.test" is signed in with a password
    When gina links SSO for subject "p5p6" and confirms with her correct password
    Then subject "p5p6" is linked to gina's user
    And identity logs the error "ledger audit append failed (best-effort)" and counts identity.audit.failures with event_type "identity.external.linked"

  @AC-29 @FR-1
  Scenario: Remember me survives the SSO round trip
    Given the user ticks "Keep me signed in for 14 days (SSO)" and clicks "Sign in with SSO" on the staging login page
    When the issuer completes the login for linked subject "a1b2"
    Then the session cookies carry Max-Age=1209600 and the "remember_me=1" marker is set
    And a later cookie rotation keeps Max-Age=1209600

  @AC-30 @FR-2 @FR-8
  Scenario: An unlinked MCP token is refused
    Given subject "q7q8" is not linked in staging
    When subject "q7q8" calls a tool with a valid token whose scope is "xstockstrat.read"
    Then the agent returns HTTP 403 with the text/plain body "not linked" and no backend RPC is sent
    And no row in identity.users or identity.external_identities is written

  @AC-31 @FR-9
  Scenario: A missing mode reads as local
    Given the staging config has no identity/auth.mode row
    When AuthenticateUser is called with email "admin@localhost" and the correct password
    Then it returns an access token and a refresh token
    And the login page shows the password form and no "Sign in with SSO" button

  @AC-32 @FR-2 @FR-14
  Scenario: Both mode keeps the built-in OAuth server for MCP
    Given staging identity/auth.mode is "both"
    When Claude registers at "/agent/oauth/register", completes "/agent/oauth/authorize" and exchanges the code at "/agent/oauth/token"
    Then the identity-minted access token is accepted on the MCP endpoint
    And an issuer JWT access token for linked subject "a1b2" is rejected with HTTP 401

  @AC-33 @FR-10
  Scenario: Deactivation ends a web session at the next refresh
    Given subject "a1b2" holds a staging web session for user "11111111-1111-4111-8111-111111111111"
    When an admin runs SetUserActive false for that user and the UI then refreshes the session
    Then the refresh is refused and the browser is sent to the login page

  @AC-34 @FR-11
  Scenario: Authorized apps points to the issuer in oidc mode
    When a signed-in user opens "/accounts/authorized-apps" in staging
    Then the page shows a link to "https://auth.example.test" for managing connected apps
    And it lists no xstockstrat OAuth grants and offers no revoke button

  @AC-35 @FR-4 @FR-14
  Scenario: Only the UI can read the OIDC client secret
    Given staging ui/oidc.client_secret is an encrypted is_secret row
    When GetSecret for namespace "ui" key "oidc.client_secret" is called with header x-internal-caller "ui" by peer SAN "xstockstrat-ui" and by peer SAN "xstockstrat-agent"
    Then the UI receives the decrypted value and the agent receives PERMISSION_DENIED
    And GetConfig and WatchConfig return the row redacted

  @AC-36 @FR-13
  Scenario: The seed-owner rule and the agent's namespaces are documented
    When an engineer reads IDENTITY-15 in services/xstockstrat-identity/docs/context-constitution.md
    Then it states that new migrations resolve the seed owner by SEED_USER_ID, never by admin@localhost
    And AGENT-9 in services/xstockstrat-agent/docs/context-constitution.md lists "agent", "identity" and "indicators" as the watched namespaces
    And the identity, ui and agent CLAUDE.md files and docs/patterns/frontend-auth.md name identity/auth.mode, the ui/oidc.* and agent/oidc.issuer keys, and the Link SSO flow

  @AC-38 @FR-4
  Scenario: Only the UI may mint sessions with IssueSessionForUser
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-agent"
    When it calls IssueSessionForUser for user_id "11111111-1111-4111-8111-111111111111"
    Then it receives PERMISSION_DENIED and no refresh token row is written

  @AC-41 @FR-14
  Scenario: A DigitalOcean deployment behaves as before this feature
    Given the DigitalOcean dev app's identity/auth.mode is "local" (the seeded default)
    When a user signs in with email "admin@localhost" and the correct password on the login page
    Then the browser lands on "/trader" with a session for that user
    And the login page shows no "Sign in with SSO" button

  @AC-42 @FR-14
  Scenario: Local-mode MCP keeps the built-in OAuth server
    Given the DigitalOcean dev app's identity/auth.mode is "local"
    When Claude registers at "/agent/oauth/register", completes "/agent/oauth/authorize" and exchanges the code at "/agent/oauth/token"
    Then the identity-minted access token is accepted on the MCP endpoint and list_strategies returns a result
    And "/accounts/authorized-apps" lists that grant with a revoke button

  @AC-43 @FR-14 @FR-2
  Scenario: Oidc mode rejects legacy tokens and routes
    Given staging identity/auth.mode is "oidc"
    When a client calls "/agent/oauth/register" or sends an identity-minted token to the MCP endpoint
    Then the register call returns HTTP 404 and the MCP call returns HTTP 401

  @AC-44 @FR-14 @FR-17
  Scenario: Setting the mode back to local rolls a deployment back
    Given staging identity/auth.mode is "oidc"
    When an operator sets it to "local" with the FR-17 command, without signing in
    Then the next login page render shows the password form and no "Sign in with SSO" button
    And within 60 seconds MCP accepts identity-minted tokens again

  @AC-45 @FR-14
  Scenario: Both mode keeps the password login while the issuer is unreachable
    Given staging identity/auth.mode is "both" and the issuer is unreachable
    When a user signs in with email "admin@localhost" and the correct password on the login page
    Then the browser lands on "/trader" with a session for that user

  @AC-46 @FR-9 @FR-11 @FR-14
  Scenario: An unreadable config renders the local login
    Given xstockstrat-config is unreachable from the UI
    When a user opens the login page
    Then the page shows the password form and no "Sign in with SSO" button
    And fetching "/.well-known/oauth-authorization-server/agent" from the staging UI returns HTTP 200 with issuer "https://xstockstrat-staging.example.test/agent"
    And "/.well-known/oauth-protected-resource/agent" lists "authorization_servers" ["https://xstockstrat-staging.example.test/agent"]

  @AC-47 @FR-14
  Scenario: The SSO routes are inert in local mode
    Given staging identity/auth.mode is "local" while ui/oidc.issuer and agent/oidc.issuer are set
    When a client POSTs "/api/auth/sso/start" from the same origin and GETs "/api/auth/sso/callback?code=c1&state=s1"
    Then both return HTTP 404 with no redirect
    And ResolveExternalIdentity is not called

  @AC-48 @FR-11
  Scenario: The authorized-apps card shows the connector details in oidc mode
    Given staging's four ui/oidc.mcp_client_id* keys hold "xstockstrat-staging-mcp-claude", "xstockstrat-staging-mcp-claude-ro", "xstockstrat-staging-mcp-claude-code" and "xstockstrat-staging-mcp-claude-code-ro"
    When a signed-in user opens "/accounts/authorized-apps" in staging
    Then the page shows the connector URL "https://xstockstrat-staging.example.test/agent" with a copy button
    And it shows those four client IDs, labelled for Claude.ai and Claude Code

  @AC-49 @FR-11 @FR-2
  Scenario Outline: The UI's discovery documents follow the MCP mode
    Given staging identity/auth.mode is "<mode>"
    When a client fetches "/.well-known/oauth-protected-resource/agent" and "/.well-known/oauth-authorization-server/agent" from the staging UI
    Then the first lists "authorization_servers" <servers>
    And the second returns <second>

    Examples:
      | mode | servers                                             | second                                                                  |
      | oidc | ["https://auth.example.test"]                       | HTTP 404                                                                |
      | both | ["https://xstockstrat-staging.example.test/agent"]  | HTTP 200 with issuer "https://xstockstrat-staging.example.test/agent"   |

  @AC-50 @FR-12 @FR-16
  Scenario: unlink-sso refuses the old subject and lets the user link again
    Given staging user "alice@example.test" is linked to subject "a1b2"
    When an admin runs "uv run scripts/manage-users.py unlink-sso alice@example.test"
    Then identity.external_identities has no row for that user
    And a login for subject "a1b2" is refused as not linked
    And with staging in "both", alice can link subject "n3w0" through Link SSO

  @AC-51 @FR-15
  Scenario: A person outside the app's group sees a no-access message
    Given the issuer answers the staging authorization request with error "access_denied"
    When the browser arrives at the staging SSO callback
    Then the login page shows "You don't have access to xstockstrat. Ask an admin." and no session cookie is set

  @AC-52 @FR-15
  Scenario: Logout ends the issuer session when the issuer supports it
    Given the issuer's discovery document advertises an end_session_endpoint
    When a signed-in user logs out
    Then the session cookies are cleared and the refresh token is revoked
    And the browser is redirected to that end_session_endpoint with post_logout_redirect_uri "https://xstockstrat-staging.example.test/auth/login"

  @AC-53 @FR-15
  Scenario: Logout falls back to the issuer's portal logout
    Given the issuer's discovery document advertises no end_session_endpoint
    When a signed-in user logs out
    Then the session cookies are cleared and the refresh token is revoked
    And the browser is redirected to the issuer's portal logout with a return address of "https://xstockstrat-staging.example.test/auth/login"

  @AC-54 @FR-1 @FR-14
  Scenario: An invalid configured issuer fails SSO sign-in closed
    Given staging ui/oidc.issuer is "http://auth.example.test"
    When a user clicks "Sign in with SSO" on the staging login page
    Then the browser returns to the login page with error "not_configured" and no session cookie is set
    And the UI logs "sso_issuer_invalid"

  @AC-55 @FR-2 @FR-14
  Scenario: The agent refuses MCP calls while its issuer configuration is invalid
    Given staging agent/oidc.issuer is "http://auth.example.test"
    When an MCP client calls the staging agent with any bearer token
    Then the agent returns HTTP 503 with no WWW-Authenticate header
    And the agent's protected-resource metadata returns HTTP 503
    And fetching "/.well-known/oauth-protected-resource/agent" from the staging UI returns HTTP 503
    And the agent logs "sso_issuer_invalid"

  @AC-56 @FR-14 @FR-15
  Scenario: Logout with an invalid issuer ends only the xstockstrat session
    Given staging ui/oidc.issuer is "http://auth.example.test"
    When a signed-in user logs out
    Then the session cookies are cleared and the refresh token is revoked
    And the browser lands on "/auth/login" without being sent to "auth.example.test"

  @AC-57 @FR-14 @FR-15
  Scenario Outline: A logout posted from another origin changes nothing
    Given staging identity/auth.mode is "<mode>" and a user is signed in
    When a page on "https://dashboard.example.test" POSTs "/api/auth/logout" with the user's cookies
    Then the response is HTTP 403
    And the session cookies are unchanged and RevokeToken is not called

    Examples:
      | mode  |
      | local |
      | both  |
      | oidc  |

  @AC-58 @FR-14
  Scenario: An invalid APP_URL fails SSO sign-in closed and skips the logout Origin check
    Given staging has valid issuers and the UI's APP_URL is "https://xstockstrat-staging.example.test/"
    When a user clicks "Sign in with SSO" on the staging login page
    Then the browser returns to the login page with error "not_configured" and no session cookie is set
    And the UI logs "app_url_invalid"
    And a signed-in user's logout carrying Origin "https://dashboard.example.test" clears the session cookies

  @AC-59 @FR-1 @FR-14
  Scenario Outline: The SSO start route accepts only a same-origin POST
    When a client sends <request> to "/api/auth/sso/start"
    Then the response is <result> and no request is sent to the issuer

    Examples:
      | request                                                     | result                                              |
      | a GET                                                       | HTTP 405                                            |
      | a POST with Origin "https://dashboard.example.test"         | a redirect to the login page with error "failed"    |
      | a POST with no Origin header                                | a redirect to the login page with error "failed"    |

  @AC-60 @FR-1 @FR-14
  Scenario: SSO start and callback fail cleanly when config is unreadable
    Given the config service is unreachable
    When a client POSTs "/api/auth/sso/start" from the same origin and GETs "/api/auth/sso/callback?code=c1&state=s1"
    Then both redirect to the login page with error "failed"
    And no session cookie is set and ResolveExternalIdentity is not called

  @AC-61 @FR-2
  Scenario: The agent answers 503 when the issuer's signing keys cannot be fetched
    Given the issuer's JWKS endpoint is unreachable
    And the agent has no cached signing key with kid "k-new"
    When an MCP client calls the staging agent with a well-formed token whose kid is "k-new" and whose iss is the staging issuer
    Then the agent returns HTTP 503 with no WWW-Authenticate header
    And the agent's auth-rejection metric records "jwks_unavailable"

  @AC-62 @FR-15
  Scenario: Logout with unreadable config ends only the xstockstrat session
    Given a user is signed in and the config service is unreachable
    When the user clicks "Sign out" in the header
    Then the session cookies are cleared and the refresh token is revoked
    And the browser lands on "/auth/login" without being sent to the issuer
    And the UI logs "sso_logout_mode_unknown"

  @AC-63 @FR-15
  Scenario Outline: The header Sign-out button ends the session in every mode
    Given staging identity/auth.mode is "<mode>" and a user is signed in on "/trader"
    When the user clicks the "Sign out" button in the shared header
    Then the session cookies are cleared
    And the browser ends on <destination>

    Examples:
      | mode  | destination                                       |
      | local | "/auth/login"                                     |
      | both  | the issuer's logout, which returns to "/auth/login" |
      | oidc  | the issuer's logout, which returns to "/auth/login" |

  @AC-64 @FR-15
  Scenario: Logout with an expired session answers JSON instead of a redirect
    Given a staging browser holds only an expired access_token cookie and a refresh_token cookie
    When it POSTs "/api/auth/logout" from the same origin
    Then the response is HTTP 200 JSON with "ok" true
    And the session cookies are cleared

  @AC-65 @FR-16
  Scenario: A password user links SSO and then signs in by SSO
    Given staging identity/auth.mode is "both"
    And "alice@example.test" (user_id "11111111-1111-4111-8111-111111111111") is signed in with a password and has no link
    When she chooses "Link SSO" and the issuer re-authenticates subject "a1b2" for a request with prompt=login and max_age=0, returning a fresh auth_time
    Then the confirmation reads "You are linking alice.sso@example.test to alice@example.test." and asks for her xstockstrat password
    And after she confirms with her correct password, identity.external_identities holds ("https://auth.example.test", "a1b2") -> "11111111-1111-4111-8111-111111111111"
    And the ledger holds one "identity.external.linked" event for that user_id with outcome "linked" and no email or subject field
    And her next "Sign in with SSO" lands on "/trader" as that user

  @AC-66 @FR-16
  Scenario: A wrong password at the link confirmation writes nothing
    Given staging identity/auth.mode is "both" and "alice@example.test" is signed in with a password
    When she links SSO for subject "a1b2" and confirms with a wrong password
    Then the confirmation shows "Incorrect password." and identity.external_identities is unchanged

  @AC-67 @FR-16
  Scenario: A user who already has a link for the issuer must be unlinked first
    Given staging identity/auth.mode is "both" and "alice@example.test" is linked to subject "a1b2" and signed in with a password
    When she links SSO, the issuer returns subject "z9z9" and she confirms with her correct password
    Then the account page shows "This account is already linked to a single sign-on account. Ask an admin to unlink it first."
    And identity.external_identities is unchanged

  @AC-68 @FR-16
  Scenario Outline: A stale or foreign link confirmation is refused
    Given staging identity/auth.mode is "both" and "alice@example.test" started Link SSO and reached the confirmation for subject "a1b2"
    When <change> and she then confirms with her correct password
    Then the page shows "Sign-in failed. Try again." and identity.external_identities is unchanged

    Examples:
      | change                                                     |
      | 11 minutes pass                                            |
      | she signs out and "bob@example.test" signs in in the same browser |

  @AC-69 @FR-16 @FR-14
  Scenario Outline: Link SSO exists only in both mode
    Given staging identity/auth.mode is "<mode>" and a user is signed in
    When the user opens "/accounts/sso" and a client POSTs "/accounts/api/sso/link" from the same origin
    Then the page shows whether the account is linked, no "Link SSO" action, and the link start returns <result>

    Examples:
      | mode  | result   |
      | local | HTTP 404 |
      | oidc  | HTTP 404 |

  @AC-70 @FR-4
  Scenario: Only the UI may call LinkExternalIdentity
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-agent"
    When it calls LinkExternalIdentity for user_id "11111111-1111-4111-8111-111111111111" and subject "a1b2"
    Then it receives PERMISSION_DENIED and no row in identity.external_identities is read or written

  @AC-71 @FR-17
  Scenario Outline: The mode command sets the mode without a login
    Given an operator on a tailnet host with access to the staging config database
    When they run the FR-17 command with "<value>" for staging
    Then <outcome>

    # "oidcc" is a deliberate misspelling: an invalid value.
    Examples:
      | value | outcome                                                                                           |
      | both  | identity/auth.mode is "both" and the running UI, identity and agent use it within 60 seconds, without a restart |
      | oidcc | the command exits non-zero, names the allowed values and changes nothing                           |

  @AC-72 @FR-9
  Scenario: An invalid stored mode reads as local and is logged
    Given the staging identity/auth.mode row holds "sso"
    When a user opens the login page and the agent receives an MCP call
    Then both behave as in "local"
    And the UI, identity and the agent each log "auth_mode_invalid" once

  @AC-73 @FR-4 @FR-16
  Scenario: Only the UI may call GetExternalIdentityLinks
    Given a gRPC client presenting mTLS peer SAN "xstockstrat-agent"
    When it calls GetExternalIdentityLinks for user_id "11111111-1111-4111-8111-111111111111"
    Then it receives PERMISSION_DENIED and no row in identity.external_identities is read

  @AC-74 @FR-16
  Scenario Outline: A link is refused without proof of re-authentication
    Given staging identity/auth.mode is "both" and "alice@example.test" started Link SSO at 12:00:00
    When the issuer returns subject "a1b2" with an ID token whose auth_time is <auth_time>
    Then the page shows "Sign-in failed. Try again." and no confirmation is offered
    And identity.external_identities is unchanged

    Examples:
      | auth_time                 |
      | absent                    |
      | 11:50:00 (before the start) |

  @AC-75 @FR-4 @FR-16
  Scenario Outline: Identity refuses a link outside both mode
    Given staging identity/auth.mode is "<mode>"
    When a client presenting mTLS peer SAN "xstockstrat-ui" calls LinkExternalIdentity for user_id "11111111-1111-4111-8111-111111111111", subject "a1b2" and that user's correct password
    Then it receives FAILED_PRECONDITION "link disabled"
    And no row in identity.users or identity.external_identities is read or written

    Examples:
      | mode  |
      | local |
      | oidc  |

  @AC-76 @FR-15 @FR-16
  Scenario Outline: An issuer error during Link SSO returns to the account page
    Given staging identity/auth.mode is "both" and "alice@example.test" is signed in with a password and started Link SSO
    When the issuer answers the link authorization request with error "<error>"
    Then the browser lands on "/accounts/sso", which shows "<message>"
    And no session cookie changes and identity.external_identities is unchanged

    Examples:
      | error          | message                                                                        |
      | access_denied  | Your single sign-on account doesn't have access to xstockstrat. Ask an admin. |
      | server_error   | Sign-in failed. Try again.                                                     |

  @AC-77 @FR-14 @FR-16
  Scenario Outline: The link routes answer fixed statuses
    Given <precondition>
    When a client sends <request>
    Then the response is <result>

    Examples:
      | precondition                                                               | request                                                                    | result                                     |
      | staging mode is "both" and no session cookie                              | GET "/accounts/api/sso"                                                    | a redirect to "/auth/login" (middleware)   |
      | staging mode is "both", a signed-in user, GetExternalIdentityLinks fails   | GET "/accounts/api/sso"                                                    | HTTP 503 with error "failed"               |
      | xstockstrat-config is unreachable from the UI and a user is signed in      | GET "/accounts/api/sso"                                                    | HTTP 200 with mode "error" and no Link action |
      | staging mode is "both" and a signed-in user                               | POST "/accounts/api/sso/link" with Origin "https://dashboard.example.test" | HTTP 403 with error "failed"               |
      | staging mode is "both", a signed-in user, ui/oidc.client_id is ""         | POST "/accounts/api/sso/link" from the same origin                         | HTTP 400 with error "not_configured"       |
      | staging mode is "both", a signed-in user, ui/oidc.client_secret unset     | POST "/accounts/api/sso/link" with Origin "https://dashboard.example.test" | HTTP 403 with error "failed"               |
      | staging mode is "both", a signed-in user, ui/oidc.client_secret unset     | POST "/accounts/api/sso/link" from the same origin                         | HTTP 400 with error "not_configured"       |
      | xstockstrat-config is unreachable from the UI and a user is signed in      | POST "/accounts/api/sso/confirm" from the same origin                      | HTTP 503 with error "failed"               |

  @AC-78 @FR-11 @FR-14
  Scenario: An unreadable agent issuer in oidc makes the UI's protected-resource document retryable
    Given staging identity/auth.mode is "oidc" and the UI cannot read the agent config namespace
    When a client fetches "/.well-known/oauth-protected-resource/agent" from the staging UI
    Then the response is HTTP 503 with "Cache-Control: no-store"

