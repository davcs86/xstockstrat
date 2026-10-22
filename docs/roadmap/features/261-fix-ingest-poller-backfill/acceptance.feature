Feature: fix-ingest-poller-backfill (bug fix)
  Regression guard for docs/reports/2026-10-21-ingest-poller-backfill-defect.md:
  the ingest mcp_client poller drops or stalls signals, and canceled backfills are revived.

  @AC-1 @regression
  Scenario: One malformed item does not drop the rest of an mcp_client batch
    Given an active mcp_client source "src-a" for user "u-1" whose fetch returns 3 items
    And item 2 has no "symbol" field
    When one poll cycle runs
    Then the signals for item 1 and item 3 are ingested for user "u-1"
    And one skipped item is logged for source "src-a"

  @AC-2 @regression
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

  @AC-3 @regression
  Scenario: A canceled backfill is not resumed after a restart
    Given backfill job "job-C" is CANCELED and still has 2 PENDING chunks
    When ingest restarts and resume_incomplete_jobs runs
    Then job "job-C" status is CANCELED
    And no chunk of job "job-C" is executed

  @AC-4 @regression
  Scenario: A hung GetSecret is bounded and recorded as that source's error
    Given ingest.mcp_client.request_timeout_seconds is 2
    And active mcp_client sources "src-a" and "src-b"
    And GetSecret for "src-a" never responds
    When one poll cycle runs
    Then source "src-a" is marked with a deadline error
    And source "src-b" is polled in the same cycle

  @AC-5 @regression
  Scenario: The signal list is found when the result also carries another list
    Given an active mcp_client source "src-a" whose fetch returns structured content {"warnings": [], "signals": [one valid AAPL item]}
    When one poll cycle runs
    Then 1 signal for "AAPL" is ingested
