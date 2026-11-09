# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (agent)

  @AC-19 @FR-6 @feature-294
  Scenario: The agent counts an mTLS fault in the auth path without changing its status
    Given MTLS_CERT is unset so mtls.secure_channel raises RuntimeError during token validation
    When a request with a bearer token reaches the MCP gate
    Then "mcp.auth.rejected" with reason "internal_error" increases by 1
    And the HTTP response status is still 401
    And the auth-path ERROR log "Unexpected error validating JWT claims" names the exception class "RuntimeError" and not the token

  @AC-20 @FR-6 @feature-294
  Scenario: A failed OAuth refresh is counted and logged without the token
    Given the identity RefreshOAuthToken call fails with UNAVAILABLE for refresh token "rt-secret-1"
    When POST /oauth/token with grant_type "refresh_token" is handled
    Then "oauth.requests" with grant_type "refresh_token" and outcome "upstream_error" increases by 1
    And a warning log contains the gRPC code "UNAVAILABLE"
    And no log line or label contains "rt-secret-1"
    And the response is still 400 with error "invalid_grant"

  @AC-21 @FR-6 @feature-294
  Scenario: Backend RPC failures are attributed to a backend and gRPC code
    Given the agent tool list_opportunities receives DEADLINE_EXCEEDED from the analysis backend
    When the tool's backend call exits its mtls.secure_channel block with that error
    Then "agent.backend.rpc_errors" with backend "analysis" and grpc_code "DEADLINE_EXCEEDED" increases by 1
    And "mcp.tool.duration" gains no new attribute key

  @AC-47 @FR-6 @feature-294
  Scenario: OAuth transaction rejects, degraded post-commit steps and onboarding lines are recorded
    Given a callback with a well-formed txn blob whose HMAC does not match
    And a non-deduplicated ingest_signal with conviction 0.9 (at or above agent.signal.alert_threshold) whose auto-alert EmitAlert fails after commit
    And a successful token exchange for user "u-9" followed by that user's first successful tool call
    When these requests complete
    Then "oauth.txn.rejected" with reason "bad_sig" increases by 1
    And "agent.degraded" with kind "auto_alert" increases by 1
    And identity's existing "OAuth code exchanged" INFO carries userId "u-9", and the agent writes 1 INFO "first successful tool call" at that user's first successful tool call with user_id "u-9" as a log field
    And no metric attribute contains "u-9"
