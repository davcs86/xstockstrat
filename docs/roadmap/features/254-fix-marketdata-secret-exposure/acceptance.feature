Feature: fix-marketdata-secret-exposure (bug fix)
  Regression guard for docs/reports/2026-10-21-marketdata-secret-exposure-defect.md:
  vendor API keys leak through transport errors (D-39) and through a header-only GetSecret grant (D-40).

  @AC-1 @FR-1 @regression
  Scenario: An FMP transport failure never reveals the API key
    Given an FMP client configured with api key "k-secret" and base URL "http://127.0.0.1:1"
    When GetFundamentalsMulti is called for "AAPL" and the HTTP transport fails
    Then an error is returned that names "fmp" and the request path "/stable/quote"
    And the error text does not contain "k-secret"
    And the error text does not contain "apikey="

  @AC-2 @FR-2 @regression
  Scenario: A Finnhub transport failure never reveals the token
    Given a Finnhub client configured with api key "k-secret" and base URL "http://127.0.0.1:1"
    When GetFundamentals is called for "AAPL" and the HTTP transport fails
    Then an error is returned that names "finnhub" and the request path "/stock/metric"
    And the error text does not contain "k-secret"
    And the error text does not contain "token="

  @AC-3 @FR-4 @regression
  Scenario: The marketdata vendor secret is refused to a peer without the marketdata SAN
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" from an mTLS peer whose DNS SAN is "xstockstrat-ingest"
    Then the call fails with PERMISSION_DENIED
    And no plaintext value is returned

  @AC-4 @FR-5 @regression
  Scenario: The marketdata service still resolves its vendor secret
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" from an mTLS peer whose DNS SAN is "xstockstrat-marketdata"
    Then the response has found true and value "alpaca-xyz"

  @AC-5 @FR-3 @regression
  Scenario: The marketdata gRPC Unavailable status never carries the vendor key
    Given marketdata uses fundamentals provider "fmp" with api key "k-secret" and base URL "http://127.0.0.1:1"
    And the fundamentals cache holds no row for "AAPL"
    When the GetFundamentals RPC is called for "AAPL"
    Then the call fails with UNAVAILABLE
    And the status message names "fmp"
    And the status message does not contain "k-secret"
    And the status message does not contain "apikey="

  @AC-6 @FR-4 @regression
  Scenario: The marketdata vendor secret is refused to a caller with no mTLS SAN
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" and no peer SAN
    Then the call fails with PERMISSION_DENIED
    And no plaintext value is returned
    # Replaces the "no SAN required" assertion at services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts:236.

  @AC-7 @FR-3 @regression
  Scenario: The marketdata batch Unavailable status never carries the vendor key
    Given marketdata uses fundamentals provider "fmp" with api key "k-secret" and base URL "http://127.0.0.1:1"
    And the fundamentals cache holds no row for "AAPL"
    When the GetFundamentalsMulti RPC is called for "AAPL"
    Then the call fails with UNAVAILABLE
    And the status message names "fmp"
    And the status message does not contain "k-secret"
    And the status message does not contain "apikey="
    # AC-5 covers marketdata_service.go:1760 (single); AC-7 covers :1704 (batch).
