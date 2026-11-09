Feature: config-dead-rows-prune
  As a platform operator, I want provably dead config rows removed with a snapshot and an audit trail,
  so that /config-ui and the gate baseline stop carrying keys nobody reads, without risking a live key.

  @AC-1 @FR-1 @FR-3
  Scenario: A dead row is deleted only with static and runtime evidence
    Given "analysis" / "opportunity.sparkline_bars" in staging has no static reader
    And the committed evidence shows zero config.read_key hits for it in either spelling over a full staging release
    And every (service, namespace) subscriber of "analysis" logged config.read_coverage in every 6 h bin
    And it is in the signed allowlist with the sha256 of its value
    When the dead-row migration runs
    Then the row is removed from config.config_values and preserved in config.config_values_premigration_296
    And exactly one audit row records the deletion with new_value NULL
    And ListKeys for namespace "analysis" in staging no longer lists "opportunity.sparkline_bars"

  @AC-2 @FR-2
  Scenario: A signed tuple that matches no row is reported, not raised
    Given the signed allowlist holds a tuple for "marketdata" / "alpaca.paper" in production
    And the production row's value no longer hashes to the signed sha256
    When the dead-row migration runs
    Then it succeeds and the row is left in place
    And config.config_keys_report_296 holds one "unmatched-signed-tuple" row for it without a value

  @AC-3 @FR-3
  Scenario: A row is kept when a subscriber's coverage log is missing
    Given "marketdata" / "alpaca.paper" has no static reader and zero config.read_key hits in either spelling over the window
    And subscriber "analysis" did not log config.read_coverage for namespace "marketdata" in one 6 h bin
    When deadRowVerdict is evaluated for ("marketdata", "alpaca.paper")
    Then the verdict is "kept:missing-coverage" and the dead-row migration does not delete the row

  @AC-4 @FR-3
  Scenario: A namespace with a UI reader is never proven dead
    Given a fixture row "ui" / "fixture.unread" has no static reader in the services and zero config.read_key hits
    And xstockstrat-ui reads namespace "ui"
    When deadRowVerdict is evaluated for ("ui", "fixture.unread")
    Then the verdict is "kept:ui-reader"

  @AC-5 @FR-3
  Scenario: A hit in the old spelling keeps the row
    Given the evidence holds one config.read_key line "ns=analysis key=analysis.opportunity.sparkline_bars"
    When deadRowVerdict is evaluated for ("analysis", "opportunity.sparkline_bars")
    Then the verdict is "kept:read-hit"

  @AC-6 @FR-1
  Scenario: Replay deletes nothing and the down restores the rows
    Given the dead-row migration has run
    When it runs a second time
    Then no further row is deleted and no further audit row is written
    And running its down re-inserts the four snapshotted rows without touching any other row

  @AC-7 @FR-4
  Scenario: The signed block, the evidence and the migration agree
    Given scripts/config-heal/dead-rows-signed.sql holds 4 tuples
    When the dead-row test runs
    Then every tuple is judged "dead" against scripts/config-heal/dead-row-evidence.tsv
    And every signed sha256 equals its seed sha in scripts/config-heal/inventory-fresh.jsonl
    And the migration contains the signed block verbatim

  @AC-8 @FR-5
  Scenario: The baseline entries leave with the rows
    Given the dead-row migration has run and scripts/config-wiring-stored.json is regenerated
    When "node scripts/check-config-wiring.mjs --final" runs
    Then it exits 0 and scripts/config-wiring.json holds no seeded-unread entry for "analysis" / "opportunity.sparkline_bars" or "marketdata" / "alpaca.paper"
    And the "ledger" / "stream.notify_enabled" entry is still present, owned by "feature 306"

  @AC-9 @FR-6
  Scenario: The spent 296 sign-off tool is gone and its neighbours are intact
    Given services/xstockstrat-indicators/app/maintenance/config_allow296.py and its test are deleted
    When the indicators test suite runs
    Then it passes with the legacy_authors tests intact
    And a repo grep for "config_allow296" matches only feature-296 artifacts and the config-rollout runbook note that the tool was removed

  @AC-10 @FR-7
  Scenario: No living doc still asserts a deleted key exists, and the kept key is untouched
    Given the dead-row migration deletes "analysis" / "opportunity.sparkline_bars" and "marketdata" / "alpaca.paper"
    When the analysis and marketdata CLAUDE.md key tables are read
    Then neither lists a deleted key as present
    And configServiceImpl.ts holds no bounds entry for "opportunity.sparkline_bars"
    And no Scenario or step in services/xstockstrat-ledger/acceptance/*.feature changes and the ledger CLAUDE.md key table is unchanged
    And "ledger" / "stream.notify_enabled" still exists in staging after the migration
