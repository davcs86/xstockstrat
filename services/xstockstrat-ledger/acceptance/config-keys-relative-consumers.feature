# Promoted from docs/roadmap/features/304-config-keys-relative-consumers/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-304` tag.

Feature: xstockstrat-ledger - namespace-relative config reads
  What xstockstrat-ledger guarantees: ledger reads and logs its config by the relative key.

  @AC-12 @FR-7 @feature-304
  Scenario: Ledger logs the relative key as read evidence
    # Bound tests: (a) a key-matching ledger reader test (getBool("export.enabled") = false is rejected with
    # FAILED_PRECONDITION; red against the prefixed reader); (b) the core log-format test configWatcher.test.ts with
    # KEY = "export.enabled"; (c) the clause below is bound to the seeded-unread entry ledger/stream.notify_enabled
    # (owner feature 306) plus baseline 1 @AC-7: if the stored row left, the entry goes STALE and the gate is red.
    Given ledger's watcher holds a snapshot in which "export.enabled" = false
    When ExportEvents reads getBool("export.enabled", true) twice
    Then ExportEvents is rejected with FAILED_PRECONDITION
    And the watcher logs exactly one "config.read_key ns=ledger key=export.enabled" record before its next coverage tick
    And "ledger" / "stream.notify_enabled", a row with zero reads and no static reader, is still kept
