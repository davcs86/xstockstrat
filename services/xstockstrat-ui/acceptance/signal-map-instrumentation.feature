# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (ui)

  @AC-33 @FR-11 @feature-294
  Scenario: A failed login is measured and logged without credentials
    Given POST /api/auth/login with an unknown email and the identity call returns Unauthenticated
    When the route handles it
    Then "ui.auth.events" with event "login_failed" increases by 1
    And an "http.server.duration" sample is recorded for route "/api/auth/login" with status 401
    And the response is still 401 {"error":"Invalid credentials"}
    And no log line or label contains the email or password

  @AC-34 @FR-11 @feature-294
  Scenario: Refresh and JWT-verify failures are distinguished
    Given refreshSession gets DeadlineExceeded from identity and JWT_SECRET is empty on another request
    When both are handled
    Then "ui.auth.events" with event "refresh_error" increases by 1
    And "ui.auth.events" with event "jwt_rejected" and reason "no_secret" increases by 1
    And refreshSession still returns null and verifyAccessToken still returns null

  @AC-35 @FR-11 @feature-294
  Scenario: The audit route reports a missing database and non-admin probes
    Given DATABASE_URL is unset and a non-admin session calls GET /config-ui/api/audit
    When the route responds
    Then a warn log records the 403
    And the response is still 403
    And with an admin session and DATABASE_URL unset the response is still 200 {"entries":[]} and a warn is logged

  # Feature 337: apart from the platform-wide `host.provider` export label added after aggregation, the keys are unchanged (sign-off in 337 context.md).
  @AC-36 @FR-11 @feature-294
  Scenario: Per-method BFF outcomes use a separate bucket-free counter
    Given the Connect dispatcher handles analysis SetOpportunityAction and it returns HTTP 500
    When the call completes
    Then "ui.bff.requests" with rpc_service "xstockstrat.analysis.v1.AnalysisService", rpc_method "SetOpportunityAction" and outcome "server_error" increases by 1
    And "http.server.duration" gains no new attribute key

  @AC-55 @FR-11 @feature-294
  Scenario: The config-ui audit route is measured
    Given an admin session calls GET /config-ui/api/audit?limit=50 and the query takes 80 ms
    When the route responds 200
    Then an "http.server.duration" sample is recorded for route "/config-ui/api/audit" with status 200
    And the response body is unchanged
