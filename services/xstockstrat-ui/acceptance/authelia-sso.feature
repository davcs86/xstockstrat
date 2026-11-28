# Promoted from docs/roadmap/features/345-authelia-sso/acceptance.feature (C-16).
Feature: authelia-sso (ui)

  Background:
    Given the issuer is "https://auth.example.test"
    And the staging AGENT_PUBLIC_URL is "https://xstockstrat-staging.example.test/agent"
    And the staging config holds ui/oidc.issuer and agent/oidc.issuer = "https://auth.example.test"
    And staging identity/auth.mode is "oidc" unless a scenario says otherwise

  @AC-1 @FR-1 @FR-3 @feature-345
  Scenario: Web login resolves a linked user and keeps their roles
    Given subject "a1b2" is linked to active staging user "11111111-1111-4111-8111-111111111111" with roles ["admin","trader"]
    When the issuer completes a login for subject "a1b2" at the staging UI callback
    Then the browser lands on "/trader" with a session whose user_id is "11111111-1111-4111-8111-111111111111" and roles are ["admin","trader"]

  @AC-2 @FR-3 @feature-345
  Scenario: A login never changes the user store
    Given subject "a1b2" is linked to active staging user "11111111-1111-4111-8111-111111111111" whose email is "alice@example.test"
    When the issuer completes a login for subject "a1b2" whose ID token's email is "alice.new@example.test"
    Then the session user_id is "11111111-1111-4111-8111-111111111111"
    And no row in identity.users or identity.external_identities changes

  @AC-3 @FR-1 @FR-3 @feature-345
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

  @AC-4 @FR-16 @feature-345
  Scenario: A subject already linked to another user cannot be linked again
    Given staging identity/auth.mode is "both"
    And subject "e5f6" is linked to staging user "carol@example.test"
    And "dave@example.test" is signed in with a password
    When dave links SSO, the issuer returns subject "e5f6" and dave confirms with his correct password
    Then the account page shows "This sign-in is already linked to another account. Ask an admin."
    And no row in identity.external_identities changes

  @AC-6 @FR-3 @feature-345
  Scenario: Prod and staging links are independent
    Given subject "a1b2" is linked to user_id "11111111-1111-4111-8111-111111111111" in staging only
    And production identity/auth.mode is "oidc"
    When the issuer completes a login for subject "a1b2" at the production UI callback
    Then the production login page shows the "isn't linked" message and no session cookie is set
    And production identity.external_identities is unchanged

  @AC-7 @FR-3 @feature-345
  Scenario: A deactivated linked user is refused at web login
    Given staging user "11111111-1111-4111-8111-111111111111" linked to subject "a1b2" has is_active false
    When the issuer completes a login for subject "a1b2" at the staging UI callback
    Then the login page shows "This account is disabled. Ask an admin." and no session cookie is set

  @AC-24 @FR-1 @feature-345
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

  @AC-29 @FR-1 @feature-345
  Scenario: Remember me survives the SSO round trip
    Given the user ticks "Keep me signed in for 14 days (SSO)" and clicks "Sign in with SSO" on the staging login page
    When the issuer completes the login for linked subject "a1b2"
    Then the session cookies carry Max-Age=1209600 and the "remember_me=1" marker is set
    And a later cookie rotation keeps Max-Age=1209600

  @AC-33 @FR-10 @feature-345
  Scenario: Deactivation ends a web session at the next refresh
    Given subject "a1b2" holds a staging web session for user "11111111-1111-4111-8111-111111111111"
    When an admin runs SetUserActive false for that user and the UI then refreshes the session
    Then the refresh is refused and the browser is sent to the login page

  @AC-34 @FR-11 @feature-345
  Scenario: Authorized apps points to the issuer in oidc mode
    When a signed-in user opens "/accounts/authorized-apps" in staging
    Then the page shows a link to "https://auth.example.test" for managing connected apps
    And it lists no xstockstrat OAuth grants and offers no revoke button

  @AC-41 @FR-14 @feature-345
  Scenario: A DigitalOcean deployment behaves as before this feature
    Given the DigitalOcean dev app's identity/auth.mode is "local" (the seeded default)
    When a user signs in with email "admin@localhost" and the correct password on the login page
    Then the browser lands on "/trader" with a session for that user
    And the login page shows no "Sign in with SSO" button

  @AC-45 @FR-14 @feature-345
  Scenario: Both mode keeps the password login while the issuer is unreachable
    Given staging identity/auth.mode is "both" and the issuer is unreachable
    When a user signs in with email "admin@localhost" and the correct password on the login page
    Then the browser lands on "/trader" with a session for that user

  @AC-46 @FR-9 @FR-11 @FR-14 @feature-345
  Scenario: An unreadable config renders the local login
    Given xstockstrat-config is unreachable from the UI
    When a user opens the login page
    Then the page shows the password form and no "Sign in with SSO" button
    And fetching "/.well-known/oauth-authorization-server/agent" from the staging UI returns HTTP 200 with issuer "https://xstockstrat-staging.example.test/agent"
    And "/.well-known/oauth-protected-resource/agent" lists "authorization_servers" ["https://xstockstrat-staging.example.test/agent"]

  @AC-47 @FR-14 @feature-345
  Scenario: The SSO routes are inert in local mode
    Given staging identity/auth.mode is "local" while ui/oidc.issuer and agent/oidc.issuer are set
    When a client POSTs "/api/auth/sso/start" from the same origin and GETs "/api/auth/sso/callback?code=c1&state=s1"
    Then both return HTTP 404 with no redirect
    And ResolveExternalIdentity is not called

  @AC-48 @FR-11 @feature-345
  Scenario: The authorized-apps card shows the connector details in oidc mode
    Given staging's four ui/oidc.mcp_client_id* keys hold "xstockstrat-staging-mcp-claude", "xstockstrat-staging-mcp-claude-ro", "xstockstrat-staging-mcp-claude-code" and "xstockstrat-staging-mcp-claude-code-ro"
    When a signed-in user opens "/accounts/authorized-apps" in staging
    Then the page shows the connector URL "https://xstockstrat-staging.example.test/agent" with a copy button
    And it shows those four client IDs, labelled for Claude.ai and Claude Code

  @AC-49 @FR-11 @FR-2 @feature-345
  Scenario Outline: The UI's discovery documents follow the MCP mode
    Given staging identity/auth.mode is "<mode>"
    When a client fetches "/.well-known/oauth-protected-resource/agent" and "/.well-known/oauth-authorization-server/agent" from the staging UI
    Then the first lists "authorization_servers" <servers>
    And the second returns <second>

    Examples:
      | mode | servers                                             | second                                                                  |
      | oidc | ["https://auth.example.test"]                       | HTTP 404                                                                |
      | both | ["https://xstockstrat-staging.example.test/agent"]  | HTTP 200 with issuer "https://xstockstrat-staging.example.test/agent"   |

  @AC-51 @FR-15 @feature-345
  Scenario: A person outside the app's group sees a no-access message
    Given the issuer answers the staging authorization request with error "access_denied"
    When the browser arrives at the staging SSO callback
    Then the login page shows "You don't have access to xstockstrat. Ask an admin." and no session cookie is set

  @AC-52 @FR-15 @feature-345
  Scenario: Logout ends the issuer session when the issuer supports it
    Given the issuer's discovery document advertises an end_session_endpoint
    When a signed-in user logs out
    Then the session cookies are cleared and the refresh token is revoked
    And the browser is redirected to that end_session_endpoint with post_logout_redirect_uri "https://xstockstrat-staging.example.test/auth/login"

  @AC-53 @FR-15 @feature-345
  Scenario: Logout falls back to the issuer's portal logout
    Given the issuer's discovery document advertises no end_session_endpoint
    When a signed-in user logs out
    Then the session cookies are cleared and the refresh token is revoked
    And the browser is redirected to the issuer's portal logout with a return address of "https://xstockstrat-staging.example.test/auth/login"

  @AC-54 @FR-1 @FR-14 @feature-345
  Scenario: An invalid configured issuer fails SSO sign-in closed
    Given staging ui/oidc.issuer is "http://auth.example.test"
    When a user clicks "Sign in with SSO" on the staging login page
    Then the browser returns to the login page with error "not_configured" and no session cookie is set
    And the UI logs "sso_issuer_invalid"

  @AC-56 @FR-14 @FR-15 @feature-345
  Scenario: Logout with an invalid issuer ends only the xstockstrat session
    Given staging ui/oidc.issuer is "http://auth.example.test"
    When a signed-in user logs out
    Then the session cookies are cleared and the refresh token is revoked
    And the browser lands on "/auth/login" without being sent to "auth.example.test"

  @AC-57 @FR-14 @FR-15 @feature-345
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

  @AC-58 @FR-14 @feature-345
  Scenario: An invalid APP_URL fails SSO sign-in closed and skips the logout Origin check
    Given staging has valid issuers and the UI's APP_URL is "https://xstockstrat-staging.example.test/"
    When a user clicks "Sign in with SSO" on the staging login page
    Then the browser returns to the login page with error "not_configured" and no session cookie is set
    And the UI logs "app_url_invalid"
    And a signed-in user's logout carrying Origin "https://dashboard.example.test" clears the session cookies

  @AC-59 @FR-1 @FR-14 @feature-345
  Scenario Outline: The SSO start route accepts only a same-origin POST
    When a client sends <request> to "/api/auth/sso/start"
    Then the response is <result> and no request is sent to the issuer

    Examples:
      | request                                                     | result                                              |
      | a GET                                                       | HTTP 405                                            |
      | a POST with Origin "https://dashboard.example.test"         | a redirect to the login page with error "failed"    |
      | a POST with no Origin header                                | a redirect to the login page with error "failed"    |

  @AC-60 @FR-1 @FR-14 @feature-345
  Scenario: SSO start and callback fail cleanly when config is unreadable
    Given the config service is unreachable
    When a client POSTs "/api/auth/sso/start" from the same origin and GETs "/api/auth/sso/callback?code=c1&state=s1"
    Then both redirect to the login page with error "failed"
    And no session cookie is set and ResolveExternalIdentity is not called

  @AC-62 @FR-15 @feature-345
  Scenario: Logout with unreadable config ends only the xstockstrat session
    Given a user is signed in and the config service is unreachable
    When the user clicks "Sign out" in the header
    Then the session cookies are cleared and the refresh token is revoked
    And the browser lands on "/auth/login" without being sent to the issuer
    And the UI logs "sso_logout_mode_unknown"

  @AC-63 @FR-15 @feature-345
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

  @AC-64 @FR-15 @feature-345
  Scenario: Logout with an expired session answers JSON instead of a redirect
    Given a staging browser holds only an expired access_token cookie and a refresh_token cookie
    When it POSTs "/api/auth/logout" from the same origin
    Then the response is HTTP 200 JSON with "ok" true
    And the session cookies are cleared

  @AC-65 @FR-16 @feature-345
  Scenario: A password user links SSO and then signs in by SSO
    Given staging identity/auth.mode is "both"
    And "alice@example.test" (user_id "11111111-1111-4111-8111-111111111111") is signed in with a password and has no link
    When she chooses "Link SSO" and the issuer re-authenticates subject "a1b2" for a request with prompt=login and max_age=1, returning a fresh auth_time
    Then the confirmation reads "You are linking alice.sso@example.test to alice@example.test." and asks for her xstockstrat password
    And after she confirms with her correct password, identity.external_identities holds ("https://auth.example.test", "a1b2") -> "11111111-1111-4111-8111-111111111111"
    And the ledger holds one "identity.external.linked" event for that user_id with outcome "linked" and no email or subject field
    And her next "Sign in with SSO" lands on "/trader" as that user

  @AC-66 @FR-16 @feature-345
  Scenario: A wrong password at the link confirmation writes nothing
    Given staging identity/auth.mode is "both" and "alice@example.test" is signed in with a password
    When she links SSO for subject "a1b2" and confirms with a wrong password
    Then the confirmation shows "Incorrect password." and identity.external_identities is unchanged

  @AC-67 @FR-16 @feature-345
  Scenario: A user who already has a link for the issuer must be unlinked first
    Given staging identity/auth.mode is "both" and "alice@example.test" is linked to subject "a1b2" and signed in with a password
    When she links SSO, the issuer returns subject "z9z9" and she confirms with her correct password
    Then the account page shows "This account is already linked to a single sign-on account. Ask an admin to unlink it first."
    And identity.external_identities is unchanged

  @AC-68 @FR-16 @feature-345
  Scenario Outline: A stale or foreign link confirmation is refused
    Given staging identity/auth.mode is "both" and "alice@example.test" started Link SSO and reached the confirmation for subject "a1b2"
    When <change> and she then confirms with her correct password
    Then the page shows "Sign-in failed. Try again." and identity.external_identities is unchanged

    Examples:
      | change                                                     |
      | 11 minutes pass                                            |
      | she signs out and "bob@example.test" signs in in the same browser |

  @AC-69 @FR-16 @FR-14 @feature-345
  Scenario Outline: Link SSO exists only in both mode
    Given staging identity/auth.mode is "<mode>" and a user is signed in
    When the user opens "/accounts/sso" and a client POSTs "/accounts/api/sso/link" from the same origin
    Then the page shows whether the account is linked, no "Link SSO" action, and the link start returns <result>

    Examples:
      | mode  | result   |
      | local | HTTP 404 |
      | oidc  | HTTP 404 |

  @AC-74 @FR-16 @feature-345
  Scenario Outline: A link is refused without proof of re-authentication
    Given staging identity/auth.mode is "both" and "alice@example.test" started Link SSO at 12:00:00
    When the issuer returns subject "a1b2" with an ID token whose auth_time is <auth_time>
    Then the page shows "Sign-in failed. Try again." and no confirmation is offered
    And identity.external_identities is unchanged

    Examples:
      | auth_time                 |
      | absent                    |
      | 11:50:00 (before the start) |

  @AC-76 @FR-15 @FR-16 @feature-345
  Scenario Outline: An issuer error during Link SSO returns to the account page
    Given staging identity/auth.mode is "both" and "alice@example.test" is signed in with a password and started Link SSO
    When the issuer answers the link authorization request with error "<error>"
    Then the browser lands on "/accounts/sso", which shows "<message>"
    And no session cookie changes and identity.external_identities is unchanged

    Examples:
      | error          | message                                                                        |
      | access_denied  | Your single sign-on account doesn't have access to xstockstrat. Ask an admin. |
      | server_error   | Sign-in failed. Try again.                                                     |

  @AC-77 @FR-14 @FR-16 @feature-345
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

  @AC-78 @FR-11 @FR-14 @feature-345
  Scenario: An unreadable agent issuer in oidc makes the UI's protected-resource document retryable
    Given staging identity/auth.mode is "oidc" and the UI cannot read the agent config namespace
    When a client fetches "/.well-known/oauth-protected-resource/agent" from the staging UI
    Then the response is HTTP 503 with "Cache-Control: no-store"
