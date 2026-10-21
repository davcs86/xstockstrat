Feature: fix-ui-transport-hardening (bug fix)
  Regression guard for docs/reports/2026-10-21-ui-transport-hardening-defect.md:
  no default gRPC deadline in the UI transport (D-37), and segment health routes gated by auth (D-38).
  The default deadline value is fixed in /sdd-design (proposed 10s, product-spec Open Question 1).

  @AC-1 @FR-1 @regression
  Scenario: A server-side gRPC call with no per-call timeout is bounded by the transport default
    Given the UI server transport for a backend that accepts the connection and never responds
    When a BFF handler issues a unary call without passing timeoutMs
    Then the call fails with DEADLINE_EXCEEDED no later than the transport's default deadline (proposed 10s)

  @AC-1b @FR-1 @regression
  Scenario: A per-call timeout overrides the transport default
    Given the UI server transport for a backend that accepts the connection and never responds
    When a BFF handler issues a unary call with timeoutMs 2000
    Then the call fails with DEADLINE_EXCEEDED after about 2 seconds, not the transport default

  @AC-2 @FR-1 @regression
  Scenario: Middleware session refresh does not hang on an unresponsive identity service
    Given an expired access token and a valid refresh-token cookie
    And an identity endpoint that accepts the connection and never responds
    When the browser requests "/trader"
    Then the response arrives no later than the default deadline (proposed 10s)
    And the response is a redirect to "/auth/login?redirect=%2Ftrader"
    And the response clears the access-token and refresh-token cookies

  @AC-3 @FR-2 @regression
  Scenario Outline: Segment health routes are reachable without a session
    Given a request with no session cookies
    When the client requests "<path>"
    Then the route handler responds (no redirect to "/auth/login")

    Examples:
      | path                        |
      | /trader/health              |
      | /trader/api/health          |
      | /insights/health            |
      | /insights/api/health        |
      | /config-ui/health           |
      | /config-ui/api/health       |
      | /accounts/api/health        |
      | /accounts/api/agent-health  |

  @AC-4 @FR-3 @regression
  Scenario Outline: Non-health segment routes still require a session
    Given a request with no session cookies
    When the client requests "<path>"
    Then the response is a redirect to "/auth/login"

    Examples:
      | path                        |
      | /trader/orders              |
      | /trader/healthcheck-x       |
      | /insights/api/health-extra  |
      | /config-ui                  |
      | /accounts                   |

  @AC-5 @FR-1 @regression
  Scenario: The alert stream is not cut off by the unary default deadline
    Given a signed-in trader with the alert stream open
    And notify sends no alert for longer than the default deadline
    When the default deadline elapses
    Then the streamAlerts connection is still open and delivers the next alert
