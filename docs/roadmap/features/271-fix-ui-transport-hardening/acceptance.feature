Feature: fix-ui-transport-hardening (bug fix)
  Regression guard for docs/reports/2026-10-21-ui-transport-hardening-defect.md:
  no default gRPC deadline in the UI transport (D-37), and segment health routes gated by auth (D-38).

  @AC-1 @regression
  Scenario: A server-side gRPC call with no per-call timeout is bounded by the transport default
    Given the UI server transport for a backend that accepts the connection and never responds
    When a BFF handler issues a unary call without passing timeoutMs
    Then the call fails with DEADLINE_EXCEEDED within the transport's default deadline

  @AC-2 @regression
  Scenario: Middleware session refresh does not hang on an unresponsive identity service
    Given an expired access token and a valid refresh-token cookie
    And an identity endpoint that accepts the connection and never responds
    When the browser requests "/trader"
    Then the middleware's refreshSession call fails within the default deadline
    And the response is a redirect to "/auth/login" rather than a hang

  @AC-3 @regression
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

  @AC-4 @regression
  Scenario: Non-health segment routes still require a session
    Given a request with no session cookies
    When the client requests "/trader/orders"
    Then the response is a redirect to "/auth/login"
