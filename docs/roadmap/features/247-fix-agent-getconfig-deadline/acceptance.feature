Feature: fix-agent-getconfig-deadline (bug fix)
  Regression guard for docs/reports/2026-10-19-agent-get-config-value-no-deadline-defect.md:
  the agent's get_config_value issues GetConfig with no deadline.
  D is the get_config_value deadline: 3.0 s, aligned with _POLICY_READ_TIMEOUT_S, final value fixed at design.

  @AC-1 @FR-1 @regression
  Scenario: get_config_value is bounded by its default deadline
    Given the config service accepts connections but never answers GetConfig
    When the agent calls get_config_value for "signal.alert_threshold" in namespace "agent"
    Then the call raises a gRPC DEADLINE_EXCEEDED error within D plus 0.5 seconds

  @AC-2 @FR-2 @regression
  Scenario: extract_website_content proceeds with its default fetch policy
    Given the config service accepts connections but never answers GetConfig
    And a registered website source "acme-site" with has_credentials false
    And its config_json.url is a public https URL that passes the SSRF egress gate and serves a 1 KB HTML page
    When the caller invokes extract_website_content with source_slug "acme-site"
    Then the tool returns {raw_text: <the page text>}
    And it returns within 4 × D plus 1 second plus the page fetch time
    # Supporting unit check (internal state, not consumer-observable): _fetch_url runs with the defaults
    # max_redirects 5, max_bytes 5000000, connect_timeout 10.0 s and read_timeout 30.0 s.

  @AC-3 @FR-2 @regression
  Scenario: ingest_signal returns and alerts against the default threshold
    Given the config service accepts connections but never answers GetConfig
    And ingest IngestSignal and notify EmitAlert are healthy
    And a registered signal source "acme-signals"
    When the caller invokes ingest_signal with source "acme-signals", symbol "NVDA", direction "buy", valid_from "2026-10-20T00:00:00Z" and conviction 0.9 for a new, non-duplicate signal
    Then the tool returns {signal_id: <int>, deduplicated: false} within D plus 1 second after IngestSignal completes
    And one alert with category "signal" is emitted, because 0.9 is at least the default alert threshold of 0.6

  @AC-4 @FR-2 @regression
  Scenario: OAuth dynamic client registration does not hang
    Given the config service accepts connections but never answers GetConfig
    And identity RegisterOAuthClient succeeds
    When a client POSTs to /oauth/register with redirect_uris ["https://client.example/cb"]
    Then the endpoint responds within 2 × D plus 1 second with HTTP 201
    And the body carries a client_id and redirect_uris ["https://client.example/cb"]

  @AC-5 @FR-3
  Scenario: a healthy config service is read unchanged under the deadline
    Given the config service answers GetConfig after 0.5 seconds with "signal.alert_threshold" set to "0.8" in namespace "agent"
    When the agent calls get_config_value for "signal.alert_threshold" in namespace "agent"
    Then the call returns "0.8"
