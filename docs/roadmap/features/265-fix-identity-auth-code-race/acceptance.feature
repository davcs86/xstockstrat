Feature: fix-identity-auth-code-race (bug fix)
  Regression guard for docs/reports/2026-10-21-identity-auth-code-race-defect.md:
  ExchangeAuthCode is check-then-act, so one authorization code can be redeemed more than once (debt-radar D-23, D-21).

  Background:
    Given an OAuth client "mcp-client-1" registered with redirect_uri "https://agent.example/callback"
    And user "u-1" was issued an authorization code for "mcp-client-1" with a PKCE S256 challenge for verifier "v-123"

  @AC-1 @FR-1 @FR-3 @regression
  Scenario: Concurrent exchanges of one authorization code yield exactly one grant
    When 20 ExchangeAuthCode calls for that code with code_verifier "v-123" run concurrently
    Then exactly 1 call returns an access token and a refresh token
    And the other 19 calls fail with UNAUTHENTICATED "invalid_grant"
    And identity.refresh_tokens holds exactly 1 new row for user "u-1" and client "mcp-client-1"

  @AC-2 @FR-1 @FR-4 @regression
  Scenario: A consumed authorization code cannot be redeemed again
    Given the code was exchanged successfully once
    When ExchangeAuthCode is called again with the same code and code_verifier "v-123"
    Then the call fails with UNAUTHENTICATED "invalid_grant"

  @AC-3 @FR-2 @regression
  Scenario: A failed refresh-token insert does not consume the authorization code
    Given the refresh-token INSERT for the exchange fails with "connection terminated"
    When ExchangeAuthCode is called with the code and code_verifier "v-123"
    Then the call fails with gRPC status INTERNAL
    And the response carries no access token or refresh token
    And the code's consumed_at is still NULL
    And identity.refresh_tokens holds no new row for user "u-1" and client "mcp-client-1"

  @AC-4 @FR-6 @FR-7 @FR-8 @regression
  Scenario: First-party login, first-party refresh and OAuth exchange issue tokens with the same claim shape and client tagging
    Given user "u-1" with email "u1@example.com" and roles ["trader"]
    When "u-1" authenticates with a password, refreshes that session, and separately exchanges an authorization code with resource "https://agent.example/mcp"
    Then every access token carries user_id "u-1", email "u1@example.com", roles ["trader"], issued_at and expires_at
    And on every access token expires_at minus issued_at equals 900 seconds
    And only the OAuth access token carries aud "https://agent.example/mcp"
    And the login refresh token is stored with client_id NULL and the OAuth refresh token with client_id "mcp-client-1"

  @AC-5 @FR-5 @regression
  Scenario Outline: A request that fails client, redirect or PKCE validation does not consume the code
    When ExchangeAuthCode is called for that code with <field> set to <value>
    Then the call fails with UNAUTHENTICATED "invalid_grant"
    And the code's consumed_at is still NULL
    And a following ExchangeAuthCode call with client "mcp-client-1", redirect_uri "https://agent.example/callback" and code_verifier "v-123" returns an access token and a refresh token

    Examples:
      | field         | value                          |
      | code_verifier | "wrong-verifier"               |
      | redirect_uri  | "https://evil.example/callback" |
      | client_id     | "other-client"                 |

  @AC-6 @FR-4 @regression
  Scenario: An expired authorization code cannot be redeemed
    Given the code's expires_at is in the past
    When ExchangeAuthCode is called with the code and code_verifier "v-123"
    Then the call fails with UNAUTHENTICATED "invalid_grant"
    And identity.refresh_tokens holds no new row for user "u-1" and client "mcp-client-1"
