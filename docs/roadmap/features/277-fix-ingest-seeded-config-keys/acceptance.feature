Feature: fix-ingest-seeded-config-keys (bug fix)
  Regression guard for the defect report docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md:
  seeded ingest config keys are never read by ingest.

  @AC-1 @regression
  Scenario: Changing a seeded MCP request timeout changes the timeout ingest uses
    Given the ingest config row for the MCP request timeout is set to 5
    When the ingest config watcher has received the snapshot
    Then the MCP client loop uses a per-call timeout of 5 seconds

  @AC-2 @regression
  Scenario: Every seeded ingest key is read under the key the snapshot carries
    Given the set of ingest keys seeded by config migrations
    When each key is looked up in a snapshot built from those seeds
    Then every seeded key is found, and none falls back to its code default
