# Promoted from docs/roadmap/features/249-fix-ibkr-request-signing/acceptance.feature (C-16). Do not hand-edit; provenance tags preserved.
Feature: fix-ibkr-request-signing (bug fix)
  Regression guard for docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md:
  IBKR request signing omits query params and never uses a Live Session Token.
  Expected signatures are known-answer vectors from an independent RFC 5849 / ibind reference signer over
  fixed inputs (Live Session Token, nonce, timestamp). The client code under test never recomputes them.

  @AC-1 @FR-3 @feature-249 @regression
  Scenario: A GET with query params is signed over those params
    Given an IBKR client with a fixed Live Session Token, nonce and timestamp
    When GetOrder sends "GET /iserver/account/orders" with query "orderId=42"
    Then the oauth_signature equals the reference signer's HMAC-SHA256 vector, keyed by the base64-decoded Live Session Token, for a base string whose parameter string includes "orderId=42" sorted with the oauth params
    And the base string URI is the request URL without its query

  @AC-2 @FR-2 @feature-249 @regression
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

  @AC-3 @FR-1 @feature-249 @regression
  Scenario: The client obtains a Live Session Token before its first regular request
    Given an IBKR account registered with OAuth credentials that the test IBKR server accepts, and no cached Live Session Token
    When ValidateCredentials runs
    Then the test server receives an RSA-SHA256-signed Live Session Token request carrying a Diffie-Hellman challenge before "GET /portfolio/accounts"
    And the "GET /portfolio/accounts" request is HMAC-SHA256 signed with the Live Session Token derived from that exchange
    And the account's CredentialStatus is CREDENTIAL_STATUS_OK

  @AC-4 @FR-4 @feature-249 @regression
  Scenario Outline: A failed Live Session Token handshake is classified per TRADING-3
    Given an IBKR account with no cached Live Session Token
    And the test IBKR server answers the Live Session Token request with <response>
    When ValidateCredentials runs
    Then the account's CredentialStatus is <status>
    And the test server receives no "GET /portfolio/accounts" request

    Examples:
      | response                                                                        | status                    |
      | HTTP 401                                                                        | CREDENTIAL_STATUS_INVALID |
      | HTTP 403                                                                        | CREDENTIAL_STATUS_INVALID |
      | HTTP 503                                                                        | CREDENTIAL_STATUS_UNKNOWN |
      | no response before the timeout                                                  | CREDENTIAL_STATUS_UNKNOWN |
      | any reply, for an access_token_secret the encryption key cannot decrypt         | CREDENTIAL_STATUS_INVALID |
      | an LST reply whose live_session_token_signature does not match                  | CREDENTIAL_STATUS_INVALID |
      | a valid LST reply, then a 2xx ssodh/init reply without authenticated:true       | CREDENTIAL_STATUS_INVALID |
      | a valid LST reply, then a ssodh/init reply with competing:true                  | CREDENTIAL_STATUS_INVALID |
      | a valid LST reply, then HTTP 503 on ssodh/init                                  | CREDENTIAL_STATUS_UNKNOWN |

  @AC-5 @FR-4 @feature-249 @regression
  Scenario: A legacy 4-field IBKR blob reads INVALID without any HTTP call
    Given an IBKR account whose credentials hold only consumer_key, access_token, access_token_secret and ibkr_account_id
    When ValidateCredentials runs
    Then the account's CredentialStatus is CREDENTIAL_STATUS_INVALID
    And the test IBKR server receives no request
    And the account keeps its broker pool entry

  @AC-6 @FR-2 @feature-249 @regression
  Scenario Outline: A 401 on a regular request is retried once, guarded by session generation
    Given an IBKR client holding a cached Live Session Token of generation G
    And the test IBKR server answers the first <method> <path> with <first>
    When the client sends <method> to <path>
    Then the client <action>
    And the call's outcome is <outcome>

    Examples:
      | method | path                           | first                                       | action                                                     | outcome                 |
      | GET    | /iserver/account/orders        | HTTP 401                                    | re-handshakes once and resends once with a new nonce       | the 200 reply           |
      | POST   | /iserver/account/U123/orders   | HTTP 401                                    | re-handshakes once and resends the same body and cOID once | the 200 reply           |
      | DELETE | /iserver/account/U123/order/42 | HTTP 401                                    | re-handshakes once and resends once                        | the 200 reply           |
      | GET    | /portfolio/accounts            | HTTP 401 on a session this call just minted | does not resend                                            | ErrInvalidCredentials   |
      | POST   | /iserver/account/U123/orders   | HTTP 401, then a duplicate-cOID rejection   | resends once                                               | uncertain, not REJECTED |
      | POST   | /iserver/account/U123/orders   | HTTP 401 on a bracket-leg submission        | does not resend                                            | ErrInvalidCredentials   |
      | GET    | /iserver/account/orders        | the pinned lapsed-brokerage-session reply   | re-runs ssodh/init once and resends once                   | the 200 reply           |

  @AC-7 @FR-1 @feature-249 @regression
  Scenario Outline: An incomplete IBKR credential blob is rejected at registration
    Given a caller registering or updating a <broker> account
    When the credentials_json omits <field>
    Then the RPC returns <result>

    Examples:
      | broker  | field          | result                           |
      | IBKR    | signature_key  | InvalidArgument                  |
      | IBKR    | encryption_key | InvalidArgument                  |
      | IBKR    | dh_prime       | InvalidArgument                  |
      | OFFLINE | every field    | success with no credential check |

  @AC-8 @FR-4 @feature-249 @regression
  Scenario: A session failure before an order POST is a definite rejection
    Given an IBKR account whose Live Session Token handshake fails with HTTP 503
    When PlaceOrder submits an order on that account
    Then the test IBKR server receives no order POST
    And the order is REJECTED, not left PENDING as an uncertain submission

  @AC-9 @FR-4 @feature-249 @regression
  Scenario Outline: A credential-rejected IBKR broker call is not counted as systemic
    Given an IBKR account and an Alpaca account, both not halted
    And the IBKR client returns ErrInvalidCredentials from <call>
    When reconcileTick runs
    Then the IBKR account is skipped for that tick with a WARN log
    And the systemic failure count does not include the IBKR account
    And no account is escalated to REDUCE_ONLY

    Examples:
      | call         |
      | ListOrders   |
      | GetPositions |

  @AC-10 @FR-1 @feature-249 @regression
  Scenario: A bad-credential handshake is negatively cached and later heals
    Given an IBKR account whose Live Session Token request the test IBKR server rejects with HTTP 401
    And ValidateCredentials has run once and the account reads CREDENTIAL_STATUS_INVALID
    When ValidateCredentials runs again before trading.ibkr.reauth_min_interval_ms has elapsed
    Then the test IBKR server receives no further Live Session Token request
    When the test IBKR server starts accepting the credentials and ValidateCredentials runs after the interval
    Then the account's CredentialStatus is CREDENTIAL_STATUS_OK

