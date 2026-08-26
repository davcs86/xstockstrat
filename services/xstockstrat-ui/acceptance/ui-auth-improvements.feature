# Durable per-service business rules for xstockstrat-ui, promoted from feature 153's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-153` tag. These are the guarantees a future feature must not silently break.

Feature: ui-auth-improvements
  As a platform operator, I want an extended login session and an automatic
  redirect to login on Unauthorized responses, so I stay signed in across
  browser restarts and an expired session returns me to sign-in instead of a
  broken page.

  @AC-1 @FR-1 @feature-153
  Scenario: Login form shows an unchecked Remember me control by default
    Given the operator opens the unified login page at "/auth/login"
    When the page renders the credentials form
    Then a "Remember me" checkbox is visible and is unchecked

  @AC-2 @FR-2 @feature-153
  Scenario: Remember me writes persistent cookies that survive browser restart
    Given the operator enters valid credentials and checks "Remember me"
    When the login POST to "/api/auth/login" succeeds
    Then the "access_token" and "refresh_token" cookies are set with a positive Max-Age
    And the Max-Age equals the extended-session duration (e.g. 604800 seconds for 7 days)

  @AC-3 @FR-3 @feature-153
  Scenario: Without Remember me the cookies stay session cookies
    Given the operator enters valid credentials and leaves "Remember me" unchecked
    When the login POST to "/api/auth/login" succeeds
    Then the "access_token" and "refresh_token" cookies are set with no Max-Age and no Expires

  @AC-4 @FR-4 @feature-153
  Scenario: Extended-session Max-Age never exceeds the server refresh-token TTL
    Given the server refresh-token TTL "identity.jwt.refresh_ttl_seconds" is 2592000 seconds
    When a "Remember me" login sets the persistent cookies
    Then the cookie Max-Age is less than or equal to 2592000 seconds

  @AC-5 @FR-5 @feature-153
  Scenario: An Unauthorized data call redirects the browser to login
    Given the operator is on "/trader" with an expired session
    When a browser BFF RPC returns gRPC Unauthenticated (HTTP 401)
    Then the browser is navigated to "/auth/login?redirect=%2Ftrader"

  @AC-6 @FR-6 @feature-153
  Scenario: The 401 redirect applies to every segment's browser client
    Given a browser gRPC client bound to any segment baseUrl ("/trader/api", "/insights/api", "/config-ui/api")
    When one of its RPCs returns gRPC Unauthenticated (HTTP 401)
    Then the same redirect-to-login behavior fires regardless of which client made the call

  @AC-7 @FR-5 @feature-153
  Scenario: The redirect does not loop on the login page itself
    Given the browser is already on "/auth/login"
    When an Unauthorized response is observed
    Then no further navigation to "/auth/login" is triggered
