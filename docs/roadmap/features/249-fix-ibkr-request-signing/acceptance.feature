Feature: fix-ibkr-request-signing (bug fix)
  Regression guard for docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md:
  IBKR request signing omits query params and never uses a Live Session Token.

  @AC-1 @regression
  Scenario: A GET with query params is signed over those params
    Given an IBKR client with a Live Session Token
    When GetOrder sends "GET /iserver/account/orders" with query "orderId=42"
    Then the oauth_signature equals HMAC-SHA256, keyed by the base64-decoded Live Session Token, of a base string whose parameter string includes "orderId=42" sorted with the oauth params
    And the base string URI is the request URL without its query

  @AC-2 @regression
  Scenario Outline: Every IBKR request is signed with the Live Session Token and carries realm
    Given an IBKR client that has completed the Live Session Token handshake
    When the client sends <method> to <path>
    Then the Authorization header starts with "OAuth realm=\"limited_poa\""
    And the oauth_signature is HMAC-SHA256 keyed by the base64-decoded Live Session Token, not "&" + access_token_secret

    Examples:
      | method | path                                 |
      | GET    | /iserver/secdef/search?symbol=AAPL&types=STK |
      | POST   | /iserver/account/U123/orders         |
      | DELETE | /iserver/account/U123/order/42       |

  @AC-3 @regression
  Scenario: The client obtains a Live Session Token before its first regular request
    Given an IBKR account registered with valid OAuth credentials and no cached Live Session Token
    When ValidateCredentials runs
    Then the client first requests a Live Session Token via the RSA-SHA256 / Diffie-Hellman handshake
    And the validation request is signed with that token
    And the account's CredentialStatus is not INVALID when IBKR accepts the signature
