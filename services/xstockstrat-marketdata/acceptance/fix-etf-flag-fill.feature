# Promoted from docs/roadmap/features/230-fix-etf-flag-fill/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-230` tag.
# Durable business rules xstockstrat-marketdata already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
# The FMP boot-seed over-count guarantee is owned by feature 255 @AC-3, not this file. 230 @AC-1 is
# retired and its ID is never reused (C-15). The one-minute rate-limit window is the code constant
# etfFlagLogEvery, not a config key.

Feature: xstockstrat-marketdata - ETF-flag background fill labels ETFs and explains every non-label outcome
  The background ETF-flag fill labels an ETF once the FMP gate reopens, and every skipped, failed,
  or unlabelled fill leaves a rate-limited, secret-free Info record.

  @AC-2 @FR-1 @regression @feature-230
  Scenario: An ETF skipped while the gate was closed is labelled on a later call once the gate reopens
    Given marketdata.fmp.daily_request_cap is 250 and the shared FMP budget has used 200 of it
    And the ETF-flag cache has no entry for "SCHD"
    And the FMP profile for "SCHD" reports isEtf true
    When GetEtfFlags is called for "SCHD" and the background filler drains the queue
    Then no FMP profile fetch is made and the response has is_etf unset
    When the shared FMP budget reports 5 used of 250
    And GetEtfFlags is called for "SCHD" and the background filler drains the queue
    And GetEtfFlags is called for "SCHD" again
    Then exactly one FMP profile fetch has been made
    And the last response has is_etf set to true

  @AC-3 @FR-2 @regression @feature-230
  Scenario Outline: A fill skipped by a closed gate logs its reason at Info level
    Given marketdata.fmp.enabled is <fmp_enabled>
    And the shared FMP budget is <budget>
    And the ETF-flag cache has no entry for "SCHD"
    When GetEtfFlags is called for "SCHD" and the background filler drains the queue
    Then exactly one Info record "etf flag fill skipped" is emitted with symbol "SCHD" and reason "<reason>"
    And the record <used_cap> used and cap attributes
    And no FMP profile fetch is made and "SCHD" is no longer pending

    Examples:
      | fmp_enabled | budget                | reason       | used_cap      |
      | false       | used 0 of cap 100     | fmp_disabled | does not have |
      | true        | used 0 of cap 0       | no_cap       | has           |
      | true        | used 80 of cap 100    | budget       | has           |
      | true        | not wired             | not_wired    | does not have |

  @AC-4 @FR-3 @regression @feature-230
  Scenario: An empty FMP profile logs an unlabelled record and stays negative-cached
    Given the gate is open and the FMP profile for "NOPROF" has no isEtf value
    When GetEtfFlags is called for "NOPROF" and the background filler drains the queue
    Then exactly one Info record "etf flag fill unlabelled" is emitted with symbol "NOPROF"
    And the record carries no attribute other than symbol and trace_id
    And a GetEtfFlags call for "NOPROF" one day later returns is_etf unset without enqueuing a fetch
    And a second empty-profile symbol filled within one minute emits no further unlabelled record
    And an empty-profile symbol filled after the clock passes one minute emits a second unlabelled record

  @AC-5 @FR-2 @regression @feature-230
  Scenario Outline: A failed fill logs only the error class, never the raw error text
    Given the gate is open and the FMP profile fetch for "SCHD" returns <error> whose text contains "apikey=SECRET"
    When GetEtfFlags is called for "SCHD" and the background filler drains the queue
    Then exactly one Info record "etf flag fill failed" is emitted with symbol "SCHD" and class "<class>"
    And the class attribute is never empty
    And neither the record message nor any attribute value contains "apikey=" or "SECRET"
    And "SCHD" is not cached and is re-queued by the next GetEtfFlags call

    Examples:
      | error                                          | class |
      | a wrapped context.DeadlineExceeded             | ctx   |
      | a wrapped fmp.ErrFMPDailyCapExceeded           | cap   |
      | an error carrying no classifier stage          | other |

  @AC-6 @FR-2 @FR-3 @regression @feature-230
  Scenario Outline: Fill records are rate-limited per slot within the one-minute window
    Given the gate and the FMP profile source are set up for the sequence <sequence> on distinct symbols
    When the background filler processes the sequence
    Then exactly <records> are emitted
    And no extra FMP profile fetch is made by the logging

    Examples:
      | sequence                                                                  | records                                   |
      | 5 budget skips within one minute                                          | 1 "skipped"                               |
      | 5 budget skips, the clock passes one minute, 1 budget skip                | 2 "skipped"                               |
      | 5 fmp_disabled skips spread over 3 minutes                                | 1 "skipped"                               |
      | fmp_disabled, budget, fmp_disabled skips within one minute                | 3 "skipped"                               |
      | budget skip, a successful fill, budget skip within one minute             | 2 "skipped"                               |
      | 2 ctx failures, then 1 cap failure within one minute                      | 2 "failed" (one per class)                |
      | 1 budget skip, 1 ctx failure, 1 empty profile within one minute           | 1 "skipped", 1 "failed", 1 "unlabelled"   |

  @AC-7 @FR-2 @regression @feature-230
  Scenario: Fill records carry the trace id of the request that enqueued the symbol
    Given the gate is closed with reason budget
    And GetEtfFlags for "SCHD" arrives through the marketdata gRPC server interceptor with x-trace-id "t-1"
    When the background filler drains the queue
    Then the "etf flag fill skipped" record for "SCHD" has trace_id "t-1"
    And a logged fill record for a symbol enqueued by a request with no x-trace-id has no trace_id attribute
