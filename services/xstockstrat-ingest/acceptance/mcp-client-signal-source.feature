# Promoted from docs/roadmap/features/166-mcp-client-signal-source/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-166` tag.
# Durable business rules xstockstrat-ingest guarantees for the mcp_client server-side signal source —
# a rule enters only by promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-ingest — mcp_client server-side signal source
  What xstockstrat-ingest guarantees for registering an external MCP server as a server-side signal
  source (endpoint + bearer token + tool), resolving its credential via GetSecret, querying its tool,
  and ingesting the parsed ExternalSignals — without routing the fetch through the Claude agent.

  @AC-1 @FR-1 @feature-166
  Scenario: Register an MCP client signal source with endpoint and tool
    Given no signal source with slug "acme-mcp" exists
    When manage_signal_source is called with operation REGISTER, source_type "mcp_client", slug "acme-mcp", and config_json {"mcp_endpoint": "https://mcp.acme.example/mcp", "mcp_tool": "get_signals"}
    Then a signal source row "acme-mcp" is persisted with source_type "mcp_client"
    And list_signal_sources returns "acme-mcp" with source_type "mcp_client" and has_credentials true

  @AC-2 @FR-2 @feature-166
  Scenario: Bearer token is stored encrypted and never returned on a read edge
    Given an "mcp_client" source "acme-mcp" registered with bearer token "sk-live-abc123"
    When list_signal_sources returns "acme-mcp"
    Then the response contains has_credentials true and no field equal to "sk-live-abc123"
    And the stored config row for the token has is_secret true with value_data equal to the "[redacted]" sentinel

  @AC-3 @FR-2 @FR-3 @feature-166
  Scenario: Ingest resolves the bearer token via GetSecret and sends it as an Authorization header
    Given an active "mcp_client" source "acme-mcp" with endpoint "https://mcp.acme.example/mcp" and tool "get_signals" and bearer token "sk-live-abc123"
    When xstockstrat-ingest runs a query cycle for "acme-mcp"
    Then it calls the config GetSecret RPC with the x-internal-caller header to obtain "sk-live-abc123"
    And the outbound MCP request to "https://mcp.acme.example/mcp" carries header "Authorization: Bearer sk-live-abc123" and no other authentication

  @AC-4 @FR-4 @feature-166
  Scenario: MCP tool result is parsed into ExternalSignals and ingested
    Given an active "mcp_client" source "acme-mcp" whose tool "get_signals" returns one item {"symbol": "AAPL", "direction": "buy", "conviction": 0.72, "headline": "Model flags AAPL"}
    When xstockstrat-ingest runs a query cycle for "acme-mcp"
    Then IngestSignal is invoked with an ExternalSignal of source "acme-mcp", symbol "AAPL", direction "buy", conviction 0.72
    And a second identical cycle returns deduplicated true for that (source, symbol, direction) tuple

  @AC-5 @FR-5 @feature-166
  Scenario: Unreachable endpoint records health without crashing the service
    Given an active "mcp_client" source "acme-mcp" whose endpoint returns HTTP 401 for an invalid token
    When xstockstrat-ingest runs a query cycle for "acme-mcp"
    Then the source row records a non-empty last_error and a degraded health value
    And the ingest service remains running and processes the next source in the cycle

  @AC-6 @FR-6 @feature-166
  Scenario: Registration without an MCP endpoint is rejected fail-closed
    Given no signal source with slug "bad-mcp" exists
    When manage_signal_source is called with operation REGISTER, source_type "mcp_client", slug "bad-mcp", and config_json {"mcp_tool": "get_signals"}
    Then the call fails with INVALID_ARGUMENT naming the missing "mcp_endpoint" field
    And no signal source row "bad-mcp" is persisted
