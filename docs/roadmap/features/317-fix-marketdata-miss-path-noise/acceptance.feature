Feature: fix-marketdata-miss-path-noise (bug fix)
  Regression guard for clustered defect reports: cancel-caused failures do not log per-item WARNs, and GetBars does
  not live-fetch on every call for a symbol that recently returned no bars.

  # guards: docs/reports/2026-11-04-cancel-warn-remaining-sites-defect.md
  @AC-1 @regression
  Scenario: a GetBars live fetch aborted by client cancellation logs no WARN
    Given a symbol "AAPL" with no stored 1Day bars
    And the GetBars client cancels its context while the live fetch is in flight
    When the live fetch returns context.Canceled
    Then no "GetBars: live fetch failed" WARN is logged
    And a live fetch that fails with a non-cancel error still logs that WARN

  # guards: docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md
  @AC-2 @regression
  Scenario: repeated GetBars for a symbol with no data performs one live fetch
    Given symbol "DNB" has no stored bars and the vendor returns no bars for it
    When GetBars is called for "DNB" three times within the back-off window
    Then exactly one live vendor fetch is made
    And "GetBars: no bars stored and live fetch returned none" is logged at most once
