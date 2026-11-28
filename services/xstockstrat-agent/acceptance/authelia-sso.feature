# Promoted from docs/roadmap/features/345-authelia-sso/acceptance.feature (C-16).
Feature: authelia-sso (agent)

  Background:
    Given the issuer is "https://auth.example.test"
    And the staging AGENT_PUBLIC_URL is "https://xstockstrat-staging.example.test/agent"
    And the staging config holds ui/oidc.issuer and agent/oidc.issuer = "https://auth.example.test"
    And staging identity/auth.mode is "oidc" unless a scenario says otherwise

  @AC-10 @FR-2 @feature-345
  Scenario: A token for another resource is rejected
    Given a valid issuer JWT access token whose aud is "https://webhooks-mcp.example.test/mcp"
    When it is sent to the staging agent's MCP endpoint
    Then the agent returns HTTP 401 with WWW-Authenticate resource_metadata "https://xstockstrat-staging.example.test/agent/.well-known/oauth-protected-resource"

  @AC-11 @FR-2 @feature-345
  Scenario: Protected-resource metadata names the issuer
    When a client fetches the staging agent's RFC 9728 protected-resource metadata
    Then "authorization_servers" is ["https://auth.example.test"]
    And "resource" is "https://xstockstrat-staging.example.test/agent"

  @AC-12 @FR-7 @feature-345
  Scenario: A read-only connector cannot trade or change config
    Given user roles ["trader"] (scope 11)
    And the token's scope is "xstockstrat.read"
    When the agent forwards a tool call
    Then x-access-scope is 1
    And the forwarded metadata carries neither the WRITE (0x02) nor the TRADING (0x08) bit

  @AC-13 @FR-7 @feature-345
  Scenario: A token cannot widen a user's roles
    Given user roles ["viewer"] (scope 1)
    And the token's scope is "xstockstrat.read xstockstrat.write xstockstrat.trade xstockstrat.admin"
    When the agent forwards a tool call
    Then x-access-scope is 1

  @AC-14 @FR-6 @FR-8 @feature-345
  Scenario: A role change reaches MCP within 60 seconds
    Given subject "a1b2" holds roles ["trader"] and has made an MCP call at 12:00:00
    When an admin sets the roles to ["viewer"] at 12:00:05
    Then an MCP call at 12:01:06 forwards x-access-scope 1

  @AC-15 @FR-8 @feature-345
  Scenario: Identity outage fails closed once the cache expires
    Given the agent cached subject "a1b2" at 12:00:00
    And xstockstrat-identity is unreachable from 12:00:30
    When subject "a1b2" calls a tool at 12:01:01
    Then the agent returns HTTP 503 and no backend RPC is sent

  @AC-21 @FR-3 @FR-8 @feature-345
  Scenario: A deactivated linked user is refused on MCP
    Given staging user "11111111-1111-4111-8111-111111111111" linked to subject "a1b2" has is_active false
    And the agent holds no cached entry for subject "a1b2"
    When subject "a1b2" calls the staging MCP endpoint with a valid token
    Then the agent returns HTTP 403 with the text/plain body "account inactive" and no backend RPC is sent

  @AC-22 @FR-2 @FR-7 @feature-345
  Scenario: A valid token runs the tool as the resolved xstockstrat user
    Given subject "a1b2" is linked to staging user "11111111-1111-4111-8111-111111111111" with roles ["trader"]
    And a valid issuer JWT access token for subject "a1b2" with aud "https://xstockstrat-staging.example.test/agent" and scope "xstockstrat.read xstockstrat.write"
    When it calls the list_strategies tool
    Then the tool returns a result
    And the backend call carries x-user-id "11111111-1111-4111-8111-111111111111" (never "a1b2") and x-access-scope 3

  @AC-23 @FR-2 @feature-345
  Scenario Outline: An invalid issuer token is rejected
    Given an issuer JWT access token for the staging agent that <defect>
    When it is sent to the staging MCP endpoint
    Then the agent returns HTTP 401 and no backend RPC is sent

    Examples:
      | defect                                          |
      | has iss "https://evil.example.test"             |
      | expired at 11:59:59 for a call at 12:00:00      |
      | has a signature not made by any key in the JWKS |
      | was minted by xstockstrat-identity (HS256)      |

  @AC-30 @FR-2 @FR-8 @feature-345
  Scenario: An unlinked MCP token is refused
    Given subject "q7q8" is not linked in staging
    When subject "q7q8" calls a tool with a valid token whose scope is "xstockstrat.read"
    Then the agent returns HTTP 403 with the text/plain body "not linked" and no backend RPC is sent
    And no row in identity.users or identity.external_identities is written

  @AC-32 @FR-2 @FR-14 @feature-345
  Scenario: Both mode keeps the built-in OAuth server for MCP
    Given staging identity/auth.mode is "both"
    When Claude registers at "/agent/oauth/register", completes "/agent/oauth/authorize" and exchanges the code at "/agent/oauth/token"
    Then the identity-minted access token is accepted on the MCP endpoint
    And an issuer JWT access token for linked subject "a1b2" is rejected with HTTP 401

  @AC-42 @FR-14 @feature-345
  Scenario: Local-mode MCP keeps the built-in OAuth server
    Given the DigitalOcean dev app's identity/auth.mode is "local"
    When Claude registers at "/agent/oauth/register", completes "/agent/oauth/authorize" and exchanges the code at "/agent/oauth/token"
    Then the identity-minted access token is accepted on the MCP endpoint and list_strategies returns a result
    And "/accounts/authorized-apps" lists that grant with a revoke button

  @AC-43 @FR-14 @FR-2 @feature-345
  Scenario: Oidc mode rejects legacy tokens and routes
    Given staging identity/auth.mode is "oidc"
    When a client calls "/agent/oauth/register" or sends an identity-minted token to the MCP endpoint
    Then the register call returns HTTP 404 and the MCP call returns HTTP 401

  @AC-55 @FR-2 @FR-14 @feature-345
  Scenario: The agent refuses MCP calls while its issuer configuration is invalid
    Given staging agent/oidc.issuer is "http://auth.example.test"
    When an MCP client calls the staging agent with any bearer token
    Then the agent returns HTTP 503 with no WWW-Authenticate header
    And the agent's protected-resource metadata returns HTTP 503
    And fetching "/.well-known/oauth-protected-resource/agent" from the staging UI returns HTTP 503
    And the agent logs "sso_issuer_invalid"

  @AC-61 @FR-2 @feature-345
  Scenario: The agent answers 503 when the issuer's signing keys cannot be fetched
    Given the issuer's JWKS endpoint is unreachable
    And the agent has no cached signing key with kid "k-new"
    When an MCP client calls the staging agent with a well-formed token whose kid is "k-new" and whose iss is the staging issuer
    Then the agent returns HTTP 503 with no WWW-Authenticate header
    And the agent's auth-rejection metric records "jwks_unavailable"

  @AC-79 @FR-2 @feature-345
  Scenario: The agent never verifies with a signing key set older than 3600 seconds
    Given the agent's last successful fetch of the issuer's JWKS, which holds kid "k-1", was 3601 seconds ago
    And the issuer's JWKS endpoint is unreachable
    When an MCP client calls the staging agent with a token signed by kid "k-1" whose iss is the staging issuer and whose claims are otherwise valid
    Then the agent returns HTTP 503 with no WWW-Authenticate header
    And the agent's auth-rejection metric records "jwks_unavailable"
    And the token is not verified with the cached key
