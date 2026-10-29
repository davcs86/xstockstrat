# Promoted from docs/roadmap/features/254-fix-marketdata-secret-exposure/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-254` tag.
# Durable business rules xstockstrat-marketdata already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata - vendor API keys never leak through errors
  Vendor API keys must not appear in transport errors (D-39) or in gRPC status messages returned to callers.

  @AC-1 @FR-1 @regression @feature-254
  Scenario: An FMP transport failure never reveals the API key
    Given an FMP client configured with api key "k-secret" and base URL "http://127.0.0.1:1"
    When GetFundamentalsMulti is called for "AAPL" and the HTTP transport fails
    Then an error is returned that names "fmp" and the request path "/stable/quote"
    And the error text does not contain "k-secret"
    And the error text does not contain "apikey="

  @AC-2 @FR-2 @regression @feature-254
  Scenario: A Finnhub transport failure never reveals the token
    Given a Finnhub client configured with api key "k-secret" and base URL "http://127.0.0.1:1"
    When GetFundamentals is called for "AAPL" and the HTTP transport fails
    Then an error is returned that names "finnhub" and the request path "/stock/metric"
    And the error text does not contain "k-secret"
    And the error text does not contain "token="

  @AC-5 @FR-3 @regression @feature-254
  Scenario: The marketdata gRPC Unavailable status never carries the vendor key
    Given marketdata uses fundamentals provider "fmp" with api key "k-secret" and base URL "http://127.0.0.1:1"
    And the fundamentals cache holds no row for "AAPL"
    When the GetFundamentals RPC is called for "AAPL"
    Then the call fails with UNAVAILABLE
    And the status message names "fmp"
    And the status message does not contain "k-secret"
    And the status message does not contain "apikey="

  @AC-7 @FR-3 @regression @feature-254
  Scenario: The marketdata batch Unavailable status never carries the vendor key
    Given marketdata uses fundamentals provider "fmp" with api key "k-secret" and base URL "http://127.0.0.1:1"
    And the fundamentals cache holds no row for "AAPL"
    When the GetFundamentalsMulti RPC is called for "AAPL"
    Then the call fails with UNAVAILABLE
    And the status message names "fmp"
    And the status message does not contain "k-secret"
    And the status message does not contain "apikey="
    # AC-5 covers marketdata_service.go:1760 (single); AC-7 covers :1704 (batch).
