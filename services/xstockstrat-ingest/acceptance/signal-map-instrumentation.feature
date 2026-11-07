# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (ingest)

  @AC-28 @FR-9 @feature-294
  Scenario: Ingest records poll outcomes and keeps the slug out of labels
    Given source slug "my-feed" polled with no credential configured
    When the poll runs
    Then "ingest.source.poll" with outcome "no_bearer" increases by 1
    And a log line names slug "my-feed"
    And no metric attribute equals "my-feed"
    And source health derivation is unchanged

  @AC-29 @FR-9 @feature-294
  Scenario: A dedup hit is counted and no longer logs at INFO
    Given a polled signal that deduplicates against signal id 41
    When it is ingested
    Then "ingest.signal.outcome" with path "mcp_poll" and outcome "deduplicated" increases by 1
    And no INFO line "deduplicated signal" is written
    And a DEBUG line is written instead

  @AC-30 @FR-9 @feature-294
  Scenario: A failing job resume is logged and counted, then still raises
    Given _resume_job for job "job-7" raises a database error after setting it RUNNING
    When the task runs
    Then an ERROR log "_resume_job failed" names job "job-7"
    And "ingest.backfill.jobs" with outcome "failed" increases by 1
    And the task logs and then re-raises the same exception object

  @AC-53 @FR-9 @feature-294
  Scenario: Ingest times polls and counts dropped items with a truncated, slug-tagged log
    Given source "my-feed" returns 5 items of which 2 have a bad direction, and one of those 2 carries a 4000-character headline
    When the poll runs
    Then the "ingest.source.poll.duration" histogram records 1 sample
    And "ingest.signal.dropped" with stage "extract" and reason "bad_symbol_direction" increases by 2
    And each extractor warning names slug "my-feed" and shows at most 200 characters of the item
    And the 3 valid items are still ingested
