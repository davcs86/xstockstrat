# Promoted from docs/roadmap/features/271-fix-ui-transport-hardening/acceptance.feature (C-16). Do not hand-edit; provenance tags preserved.
Feature: fix-ui-transport-hardening (bug fix)
  UI transport default gRPC deadline (30s unary, 10s session refresh) and unauthenticated segment health routes.

  @AC-1 @FR-1 @regression @feature-271
  Scenario: A server-side gRPC call with no per-call timeout is bounded by the transport default
    Given the UI server transport for a backend that accepts the connection and never responds
    When a BFF handler issues a unary call without passing timeoutMs
    Then the call fails with DEADLINE_EXCEEDED no later than the transport's default deadline (30s)

  @AC-6 @FR-1 @regression @feature-271
  Scenario: A per-call timeout overrides the transport default
    Given the UI server transport for a backend that accepts the connection and never responds
    When a BFF handler issues a unary call with timeoutMs 2000
    Then the call fails with DEADLINE_EXCEEDED after about 2 seconds, not the transport default

  @AC-2 @FR-1 @regression @feature-271
  Scenario: Middleware session refresh does not hang on an unresponsive identity service
    Given an expired access token and a valid refresh-token cookie
    And an identity endpoint that accepts the connection and never responds
    When the browser requests "/trader"
    Then the response arrives no later than the session-refresh deadline (10s)
    And the response is a redirect to "/auth/login?redirect=%2Ftrader"
    And the response clears the access-token and refresh-token cookies

  @AC-3 @FR-2 @regression @feature-271
  Scenario Outline: Segment health routes are reachable without a session
    Given a request with no session cookies
    When the client requests "<path>"
    Then the route handler responds with status <status> (no redirect to "/auth/login")

    Examples:
      | path                        | status |
      | /trader/health              | 200    |
      | /trader/api/health          | 200    |
      | /insights/health            | 200    |
      | /insights/api/health        | 200    |
      | /config-ui/health           | 200    |
      | /config-ui/api/health       | 200    |
      | /accounts/api/health        | 200    |
      | /accounts/api/agent-health  | 401    |

  @AC-4 @FR-3 @regression @feature-271
  Scenario Outline: Non-health segment routes still require a session
    Given a request with no session cookies
    When the client requests "<path>"
    Then the response is a redirect to "/auth/login"

    Examples:
      | path                        |
      | /trader/orders              |
      | /trader/healthcheck-x       |
      | /insights/api/health-extra  |
      | /healthcheck-x              |
      | /health/anything            |
      | /config-ui                  |
      | /accounts                   |

  @AC-5 @FR-1 @regression @feature-271
  Scenario: The alert stream is not cut off by the unary default deadline
    Given a signed-in trader with the alert stream open
    And notify sends no alert for longer than the default deadline
    When the default deadline elapses
    Then the streamAlerts connection is still open and delivers the next alert
