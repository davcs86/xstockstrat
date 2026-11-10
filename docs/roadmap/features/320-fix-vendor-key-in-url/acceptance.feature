Feature: fix-vendor-key-in-url (bug fix)
  Regression guard for defect report: marketdata vendor API keys still ride in the request URL.

  # guards: docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md
  @AC-1 @regression
  Scenario: A vendor redirect with an unparseable Location never surfaces the API key
    Given an FMP client pointed at a test server that answers 302 with an unparseable Location header containing the request query string
    When GetFundamentalsMulti is called
    Then the returned error text, gRPC status message and log line contain neither "apikey=" nor the key value

  # guards: docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md
  @AC-2 @regression
  Scenario: Vendor request URLs carry no API key
    Given marketdata FMP and Finnhub clients configured with API keys
    When each client issues a vendor request through a proxy that logs full request URLs
    Then no logged URL contains "apikey=" or "token=" or the key value
