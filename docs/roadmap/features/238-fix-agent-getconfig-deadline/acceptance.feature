Feature: fix-agent-getconfig-deadline (bug fix)
  Regression guard for docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md:
  the agent's get_config_value issues GetConfig with no deadline.
  Shared given: the config service accepts connections but never answers GetConfig.
  D is the get_config_value deadline: 3.0 s, aligned with _POLICY_READ_TIMEOUT_S, final value fixed at design.

  @AC-1 @regression
  Scenario: get_config_value is bounded by its default deadline
    When the agent calls get_config_value for "signal.alert_threshold" in namespace "agent"
    Then the call raises a gRPC DEADLINE_EXCEEDED error within D plus 0.5 seconds

  @AC-2 @regression
  Scenario: extract_website_content proceeds with its default fetch policy
    Given a reachable URL serving a 1 KB HTML page
    When the caller invokes extract_website_content for that URL
    Then the tool returns the page content
    And the fetch policy used is max_redirects 5, max_bytes 5000000, connect_timeout 10.0 s and read_timeout 30.0 s
    And the policy reads finish within 4 × D plus 1 second

  @AC-3 @regression
  Scenario: ingest_signal returns and alerts against the default threshold
    When the caller invokes ingest_signal with conviction 0.9 for a new, non-duplicate signal
    Then the signal is persisted and the tool returns within D plus 1 second after IngestSignal completes
    And an alert is emitted, because 0.9 is at least the default alert threshold of 0.6

  @AC-4 @regression
  Scenario: OAuth dynamic client registration does not hang
    When a client POSTs a registration with redirect_uris ["https://client.example/cb"]
    Then the registration endpoint responds within 2 × D plus 1 second, with no HTTP 500
    And the response is the one for registration enabled with an empty redirect-URI allowlist
