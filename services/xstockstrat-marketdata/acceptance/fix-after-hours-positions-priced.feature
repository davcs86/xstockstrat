# Promoted from docs/roadmap/features/231-fix-after-hours-positions-priced/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-231` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata — quote mark_price from the two-sided mid or a bounded stored close
  Regression guard for docs/reports/2026-10-19-after-hours-one-sided-quote-half-price-defect.md:
  after-hours positions priced at about half value from a one-sided quote.
  Shared givens: LYFT lone side 16.05; stored LYFT 1d close 16.98; mark_close_max_age_hours 168.

  @AC-4 @FR-6 @regression @feature-231
  Scenario Outline: The EDGAR fundamentals snapshot is priced from the quote mark
    Given marketdata.fundamentals.snapshot_source is "edgar" and marketdata.edgar.enabled is true
    And "LYFT" has no fresh edgar cache row and its latest filing's filed-date close is 14.20
    And the latest "LYFT" quote has ask <ask> and bid <bid>
    And the newest stored 1d "LYFT" close is 16.98, stored <age> ago
    When marketdata GetFundamentals is called for "LYFT"
    Then the snapshot price is <price>
    And an edgar cache row for "LYFT" is <cached>

    Examples:
      | ask   | bid   | age       | price | cached      |
      | 16.05 | 0     | 24 hours  | 16.98 | written     |
      | 17.10 | 17.00 | 24 hours  | 17.05 | written     |
      | 16.05 | 0     | 200 hours | 14.20 | not written |

  @AC-5 @FR-1 @feature-231
  Scenario: A two-sided quote's mark is its mid, not the stored close
    Given the latest "LYFT" quote has ask 17.10 and bid 17.00
    And the newest stored 1d "LYFT" close is 16.98, stored 24 hours ago
    When marketdata GetLatestQuotes is called for "LYFT"
    Then the "LYFT" mark_price is 17.05 within 1e-9

  @AC-7 @FR-1 @feature-231
  Scenario Outline: The mark comes from a close inside the staleness bound, and raw quote fields are unchanged
    Given marketdata.quotes.mark_close_max_age_hours is 168
    And the latest "LYFT" quote has ask 16.05 and bid 0
    And the only stored 1d "LYFT" close is <close>
    When marketdata GetLatestQuotes is called for "LYFT"
    Then the "LYFT" mark_price is <mark>
    And the "LYFT" ask_price is 16.05 and bid_price is 0

    Examples:
      | close                      | mark  |
      | 16.98 stored 167 hours ago | 16.98 |
      | 16.98 stored 169 hours ago | unset |
      | absent (never ingested)    | unset |

  @AC-10 @FR-6 @feature-231
  Scenario: EDGAR multi-symbol fundamentals price pending symbols with one quote call
    Given marketdata.fundamentals.snapshot_source is "edgar" and marketdata.edgar.enabled is true
    And "LYFT" and "MSFT" both have a latest filing and no fresh edgar cache row
    And the latest "LYFT" quote has ask 16.05 and bid 0 with stored 1d close 16.98 from 24 hours ago
    And the latest "MSFT" quote has ask 534.00 and bid 533.30
    When marketdata GetFundamentalsMulti is called for "LYFT" and "MSFT"
    Then exactly one GetLatestQuotes call is made, for "LYFT" and "MSFT"
    And the "LYFT" snapshot price is 16.98 and the "MSFT" snapshot price is 533.65 within 1e-9

  @AC-11 @FR-2 @feature-231
  Scenario: A failed close lookup keeps two-sided marks and leaves one-sided marks unset
    Given the close lookup does not answer within marketdata.quotes.mark_timeout_ms
    And the latest "LYFT" quote has ask 16.05 and bid 0
    And the latest "MSFT" quote has ask 534.00 and bid 533.30
    When marketdata GetLatestQuotes is called for "LYFT" and "MSFT"
    Then the "MSFT" mark_price is 533.65 within 1e-9
    And the "LYFT" mark_price is unset
    And a WARN "GetLatestQuotes: mark lookup failed" is logged

  @AC-12 @FR-2 @feature-231
  Scenario: The close lookup runs concurrently with the cold fetch
    Given "LYFT" is cold and its live quote is ask 16.05 and bid 0
    And the live cold fetch does not return until the close lookup has started
    And the newest stored 1d "LYFT" close is 16.98, stored 24 hours ago
    When marketdata GetLatestQuotes is called for "LYFT"
    Then the "LYFT" quote is returned with mark_price 16.98

  @AC-15 @FR-2 @feature-231
  Scenario: A hanging close lookup is bounded by its budget
    Given marketdata.quotes.mark_timeout_ms is 100
    And "LYFT" is cold and its live quote is ask 16.05 and bid 0
    And the close lookup never answers
    When marketdata GetLatestQuotes is called for "LYFT"
    Then the "LYFT" quote is returned in under 1 second with mark_price unset
