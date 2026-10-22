Feature: fix-ingest-seeded-config-keys (bug fix)
  Regression guard for the defect report docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md:
  seeded ingest config keys are never read by ingest.

  @AC-1 @FR-1 @FR-3 @regression
  Scenario: Changing the seeded MCP request timeout changes the timeout ingest uses
    Given the ingest config row "ingest.mcp_client.request_timeout_seconds" is set to 5
    When the ingest config watcher has received the snapshot
    Then the MCP client loop uses a per-call timeout of 5 seconds, not the default of 30

  @AC-2 @FR-1 @FR-3 @regression
  Scenario Outline: Every seeded ingest key is read under the key the snapshot carries
    Given a snapshot built from the config migration seeds with "<key>" set to <value>
    When ingest reads "<key>" through its config watcher
    Then ingest sees <value>, not its code default <default>

    Examples:
      | key                                          | value | default |
      | ingest.backfill.chunk_max_bars               | 1234  | 200000  |
      | ingest.backfill.chunk_window_days            | 7     | 90      |
      | ingest.backfill.max_concurrent_chunks        | 1     | 3       |
      | ingest.mcp_client.poll_interval_seconds      | 11    | 300     |
      | ingest.mcp_client.request_timeout_seconds    | 5     | 30      |

  @AC-3 @FR-2 @regression
  Scenario: Re-keying preserves an operator-edited seeded row
    Given the bare row "backfill.chunk_window_days" in namespace ingest was edited to 14 in production
    When the re-key migration runs
    Then the row "ingest.backfill.chunk_window_days" has value 14 and type int
    And no bare "backfill.chunk_window_days" row remains
    And no "ingest.ingest.backfill.chunk_window_days" row exists

  @AC-4 @FR-2
  Scenario: Re-running the re-key migration is a no-op
    Given the five ingest rows are already stored in the full dotted form
    When the re-key migration runs again
    Then no row is changed or duplicated

  @AC-5 @FR-4
  Scenario: Unseeded ingest keys have a recorded decision
    Given ingest reads "ingest.backfill.max_concurrent_jobs" and "ingest.backfill.retry_on_failure"
    When the design is approved
    Then context.md records whether each key is seeded or left to its code default
