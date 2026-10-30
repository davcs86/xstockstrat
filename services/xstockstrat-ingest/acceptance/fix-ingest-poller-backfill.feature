# Promoted from docs/roadmap/features/261-fix-ingest-poller-backfill/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-261` tag.
# Durable business rules xstockstrat-ingest guarantees for the mcp_client poller and backfill cancel lifecycle.

Feature: xstockstrat-ingest - mcp_client poller isolates failures and backfill cancel is final
  Regression guard for docs/reports/2026-10-21-ingest-poller-backfill-defect.md:
  the ingest mcp_client poller drops or stalls signals, and canceled backfills are revived.

  @AC-1 @FR-1 @regression @feature-261
  Scenario: One failing item does not drop the rest of an mcp_client batch
    Given an active mcp_client source "src-a" for user "u-1" whose fetch returns 3 items that all pass extraction
    And ingesting item 2 raises an error
    When one poll cycle runs
    Then the signals for item 1 and item 3 are ingested for user "u-1"
    And the poll emits a log record for source "src-a" with a skipped count of 1
    And source "src-a" has no last_error from this poll

  @AC-2 @FR-2 @regression @feature-261
  Scenario Outline: A backfill canceled while queued stays CANCELED and never runs
    Given ingest.backfill.max_concurrent_jobs is 1
    And backfill job "job-A" is RUNNING and a <kind> backfill job "job-B" is QUEUED behind it
    When job "job-B" is canceled and then job "job-A" finishes
    Then job "job-B" status is CANCELED
    And no "ingest.backfill.running" event is emitted for "job-B"
    And marketdata <rpc> is never called for "job-B"

    Examples:
      | kind         | rpc                  |
      | bars         | BackfillBars         |
      | fundamentals | BackfillFundamentals |

  @AC-3 @FR-4 @regression @feature-261
  Scenario: A canceled backfill is not resumed after a restart
    Given backfill job "job-C" is CANCELED and still has 2 PENDING chunks
    When ingest restarts and resume_incomplete_jobs runs
    Then job "job-C" status is CANCELED
    And no chunk of job "job-C" is executed

  @AC-4 @FR-5 @regression @feature-261
  Scenario: A hung GetSecret is bounded and recorded as that source's error
    Given ingest.mcp_client.request_timeout_seconds is 2
    And active mcp_client sources "src-a" and "src-b"
    And GetSecret for "src-a" never responds
    When one poll cycle runs
    Then the cycle completes within 10 seconds
    And ListSignalSources shows a deadline error in the last_error of "src-a"
    And source "src-b" is polled in the same cycle

  @AC-5 @FR-6 @regression @feature-261
  Scenario: The signal list is found when the result also carries another list
    Given an active mcp_client source "src-a" whose fetch returns structured content {"warnings": [], "signals": [one valid AAPL item]}
    When one poll cycle runs
    Then 1 signal for "AAPL" is ingested

  @AC-6 @FR-3 @regression @feature-261
  Scenario: A fundamentals backfill canceled mid-run is not finalized as COMPLETED or PARTIAL
    Given fundamentals backfill job "job-D" is RUNNING with its BackfillFundamentals call in flight
    When job "job-D" is canceled and then the BackfillFundamentals call returns success
    Then job "job-D" status is CANCELED
    And get_backfill_status for "job-D" reports CANCELED

  @AC-7 @FR-6 @regression @feature-261
  Scenario: An ambiguous result shape is recorded as a source error
    Given an active mcp_client source "src-a" whose fetch returns structured content {"alerts": [one valid MSFT item], "rows": [one valid TSLA item]}
    And no rule selects either list as the signal list
    When one poll cycle runs
    Then no signal is ingested for source "src-a"
    And ListSignalSources shows an ambiguous-result error in the last_error of "src-a"

  @AC-8 @FR-1 @regression @feature-261
  Scenario: A batch in which every item fails is recorded as the source's error
    Given an active mcp_client source "src-a" for user "u-1" whose fetch returns 1 item that passes extraction
    And ingesting that item raises an error
    When one poll cycle runs
    Then no signal is ingested for source "src-a"
    And the poll emits a log record for source "src-a" with a skipped count of 1 before the error is recorded
    And ListSignalSources shows an "all 1 items failed" error in the last_error of "src-a"
