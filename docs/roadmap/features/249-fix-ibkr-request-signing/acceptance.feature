Feature: fix-ibkr-request-signing (bug fix)
  Regression guard for docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md:
  IBKR request signing omits query params and never uses a Live Session Token.
  Expected signatures are known-answer vectors from an independent RFC 5849 / ibind reference signer over
  fixed inputs (Live Session Token, nonce, timestamp). The client code under test never recomputes them.

  @AC-1 @FR-3 @regression
  Scenario: A GET with query params is signed over those params
    Given an IBKR client with a fixed Live Session Token, nonce and timestamp
    When GetOrder sends "GET /iserver/account/orders" with query "orderId=42"
    Then the oauth_signature equals the reference signer's HMAC-SHA256 vector, keyed by the base64-decoded Live Session Token, for a base string whose parameter string includes "orderId=42" sorted with the oauth params
    And the base string URI is the request URL without its query

  @AC-2 @FR-2 @regression
  Scenario Outline: Every IBKR request is signed with the Live Session Token and carries realm
    Given an IBKR client that has completed the Live Session Token handshake, with a fixed nonce and timestamp
    When the client sends <method> to <path>
    Then the Authorization header starts with "OAuth realm=\"limited_poa\""
    And the oauth_signature equals the reference signer's vector keyed by the base64-decoded Live Session Token
    And the oauth_signature does not equal the vector keyed by "&" + access_token_secret

    Examples:
      | method | path                                         |
      | GET    | /iserver/secdef/search?symbol=AAPL&types=STK |
      | POST   | /iserver/account/U123/orders                 |
      | DELETE | /iserver/account/U123/order/42               |

  @AC-3 @FR-1 @regression
  Scenario: The client obtains a Live Session Token before its first regular request
    Given an IBKR account registered with OAuth credentials that the test IBKR server accepts, and no cached Live Session Token
    When ValidateCredentials runs
    Then the test server receives an RSA-SHA256-signed Live Session Token request carrying a Diffie-Hellman challenge before "GET /portfolio/accounts"
    And the "GET /portfolio/accounts" request is HMAC-SHA256 signed with the Live Session Token derived from that exchange
    And the account's CredentialStatus is CREDENTIAL_STATUS_OK

  @AC-4 @FR-4 @regression
  Scenario Outline: A failed Live Session Token handshake is classified per TRADING-3
    Given an IBKR account with no cached Live Session Token
    And the test IBKR server answers the Live Session Token request with <response>
    When ValidateCredentials runs
    Then the account's CredentialStatus is <status>
    And the test server receives no "GET /portfolio/accounts" request

    Examples:
      | response                        | status                    |
      | HTTP 401                        | CREDENTIAL_STATUS_INVALID |
      | HTTP 403                        | CREDENTIAL_STATUS_INVALID |
      | HTTP 503                        | CREDENTIAL_STATUS_UNKNOWN |
      | no response before the timeout  | CREDENTIAL_STATUS_UNKNOWN |
