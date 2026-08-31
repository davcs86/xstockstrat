# Acceptance scenarios for feature 128 — ui-middleware-nodejs-runtime.
# @AC-* IDs are append-only; each Scenario traces to a test step at /sdd-spec (Constitution C-15).
# This is an internal auth-transport refactor: observable behavior (refresh, redirect-to-login,
# cookie attributes) is UNCHANGED. Scenarios assert the PRESERVED behavior plus the refactor's
# structural outcomes (Node.js runtime, in-process refresh, removed loopback workaround).

Feature: ui-middleware-nodejs-runtime
  As a platform engineer, xstockstrat-ui's middleware runs in the Node.js runtime and refreshes
  near-expiry access tokens by calling xstockstrat-identity's refreshSession() in-process, instead
  of self-fetching /api/auth/refresh — with no change to what a browser observes.

  @AC-1 @FR-1
  Scenario: The middleware runs on the Node.js runtime
    Given src/middleware.ts exports its config object
    When the exported config is inspected
    Then config.runtime equals "nodejs"
    And the exported config still declares its route matcher

  @AC-2 @FR-2
  Scenario: A near-expiry access token is refreshed in-process, not via a self-fetch
    Given an authenticated request whose access token is within ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS of expiry
    And the request carries a valid "refresh_token" cookie
    When middleware.ts runs
    Then it calls refreshSession() from src/lib/identity.ts with the value of the "refresh_token" cookie
    And it makes no outbound fetch() to /api/auth/refresh

  @AC-3 @FR-3
  Scenario: Refreshed cookies keep the same attributes as before the change
    Given a request whose near-expiry access token is refreshed in-process by the middleware
    When the middleware returns its NextResponse
    Then the response sets the new "access_token" and "refresh_token" cookies via setSessionCookies
    And each cookie keeps the same httpOnly, secure, sameSite, path, and max-age attributes it had under the pre-change /api/auth/refresh flow

  @AC-4 @FR-4
  Scenario: An expired or invalid session still redirects to login with cookies cleared
    Given an authenticated request whose refresh_token is expired or invalid
    When middleware.ts runs and refreshSession() rejects
    Then the middleware clears the session cookies via clearSessionCookies
    And the response redirects to "/auth/login"

  @AC-5 @FR-5
  Scenario: PR #925's loopback workaround is removed
    Given the feature is implemented
    When src/lib/auth.ts and src/middleware.ts are inspected
    Then buildInternalRefreshUrl no longer exists in src/lib/auth.ts
    And no fetch() to /api/auth/refresh remains in src/middleware.ts
    And the middleware matcher no longer excludes the "api/auth/refresh" path

  @AC-6 @FR-1 @FR-7
  Scenario: Node.js-runtime middleware imports connect-node-backed code and the standalone build succeeds
    Given src/middleware.ts imports src/lib/identity.ts, which transitively imports "@connectrpc/connect-node"
    When the app is built with next config output "standalone" and packaged in the Docker image
    Then the build completes with no Edge-runtime bundling error for the Node-only gRPC transport
    And the resulting container serves auth-guarded routes and performs an in-process token refresh

  @AC-7 @FR-6
  Scenario: Edge-only docs are corrected to describe the Node.js-runtime middleware
    Given the feature is implemented
    When services/xstockstrat-ui/docs/patterns/frontend-auth.md and services/xstockstrat-ui/CLAUDE.md are inspected
    Then neither states the rule "Only lib/auth.ts may be imported from middleware.ts" as a current constraint
    And both describe middleware.ts running in the Node.js runtime and calling refreshSession() directly
