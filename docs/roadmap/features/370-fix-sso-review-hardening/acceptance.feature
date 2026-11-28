Feature: fix-sso-review-hardening (bug fix)
  Regression guard for docs/reports/2026-11-28-sso-review-hardening-nits-defect.md: SSO review
  hardening nits on shipped feature 345. Promote to the durable suites at launch (C-16).

  @AC-1 @regression
  Scenario: Forged identity headers never reach a UI handler
    Given a signed-in request to "/trader" carrying headers x-user-id "forged" and x-access-scope "15"
    When the UI middleware forwards it, on the plain, near-expiry-refresh and expired-refresh paths alike
    Then the forwarded request has no x-user-id and no x-access-scope header
    And it carries an x-trace-id header

  @AC-2 @regression
  Scenario: A public path also drops forged identity headers
    Given a request to "/api/auth/sso/callback" carrying headers x-user-id "forged" and x-access-scope "15"
    When the UI middleware passes it through without a session check
    Then the forwarded request has no x-user-id and no x-access-scope header

  @AC-3 @regression
  Scenario: A middleware-rotated session is what the handler sees
    Given a request whose access token is within 60 s of expiry and refresh_token "rt-old"
    When the middleware rotates the session to access token "at-new" and refresh token "rt-new"
    Then the forwarded request's cookies carry access_token "at-new" and refresh_token "rt-new"

  @AC-4 @regression
  Scenario Outline: Identity serves the SSO session RPCs only outside local mode
    Given identity/auth.mode is "<mode>" and a caller presenting the allowed mTLS peer SAN
    When it calls <rpc>
    Then it receives <result>

    Examples:
      | mode  | rpc                     | result                                         |
      | local | IssueSessionForUser     | FAILED_PRECONDITION "sso disabled", no token row written |
      | local | ResolveExternalIdentity | FAILED_PRECONDITION "sso disabled", no query run |
      | both  | IssueSessionForUser     | a session                                      |
      | both  | ResolveExternalIdentity | the linked user                                |
      | oidc  | IssueSessionForUser     | a session                                      |
      | oidc  | ResolveExternalIdentity | the linked user                                |

  @AC-5 @regression
  Scenario Outline: A link confirmation is accepted only from the session that started it
    Given identity/auth.mode is "both" and "alice@example.test" started Link SSO in session A and reached the confirmation
    When <who> confirms with her correct password
    Then <result>

    Examples:
      | who                                                         | result                                              |
      | session A                                                   | the link is written                                 |
      | session A, which rotated its session at link start          | the link is written                                 |
      | a second signed-in session B of the same user               | "Sign-in failed. Try again." and no link is written |

  @AC-6 @regression
  Scenario: Link start rotates a session too close to expiry to outlive the link window
    Given a signed-in session whose access token has fewer than 660 s left
    When the user starts Link SSO
    Then the session is rotated first, the rotated cookies are set on the response
    And the transaction is bound to the rotated refresh token

  @AC-7 @regression
  Scenario: Link start fails closed when the access-token lifetime cannot cover the link window
    Given identity/jwt.access_ttl_seconds is 300
    When a signed-in user starts Link SSO
    Then the link start answers HTTP 503 {"error":"failed"}, sets no transaction cookie
    And the UI logs "sso_link_refused" with reason "access_ttl_too_short"

  @AC-8 @regression
  Scenario Outline: Every callback failure after the transaction is opened clears its cookie
    Given an open <purpose> transaction cookie for state "s1"
    When the callback fails because <failure>
    Then the response expires that transaction cookie

    Examples:
      | purpose | failure                               |
      | login   | the client secret is not configured   |
      | login   | the code exchange fails               |
      | login   | the subject is not linked             |
      | login   | IssueSessionForUser fails             |
      | link    | the code exchange fails               |
      | link    | the ID token has no auth_time         |

  @AC-9 @regression
  Scenario: The pending-link cookie is sent only to its readers
    When the callback sets the "sso_link" cookie
    Then its Path is "/accounts/api/sso"
    And clearing it (confirm, logout) uses the same Path

  @AC-10 @regression
  Scenario Outline: The agent verifies signatures only with signing keys
    Given the issuer's JWKS holds one RS256 key "k1" with use <use>
    When the agent ingests the key set
    Then key "k1" is <outcome>

    Examples:
      | use       | outcome                                          |
      | "enc"     | skipped, logging "jwks key skipped" reason "use" |
      | "sig"     | used                                             |
      | (absent)  | used                                             |
