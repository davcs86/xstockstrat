# Promoted from docs/roadmap/features/305-config-dead-rows-prune/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-305` tag.
# Durable business rules xstockstrat-config guarantees for dead-row deletion: snapshot and audit before delete, unmatched signed tuples reported not raised, replay no-op and restoring down.

# 2026-11-10 (feature 306, operator-signed C-16, davcs86): 305 @AC-1 is a scoped CHANGE: feature 306 deletes `ledger/stream.notify_enabled`,
# `platform/log_level` and `trading/risk.daily_loss_limit` by key, without read-evidence or a signed sha, by operator decision.

Feature: xstockstrat-config - dead config row pruning
  What xstockstrat-config guarantees: a provably dead row is removed only with a snapshot and an audit trail, a signed tuple that matches no row is reported and never raised, and the migration is replay-safe and reversible.

  @AC-1 @FR-1 @FR-3 @feature-305
  Scenario: A dead row is deleted only with static and runtime evidence
    Given "analysis" / "opportunity.sparkline_bars" in staging has no static reader
    And the committed evidence shows zero config.read_key hits for it in either spelling over a full staging release
    And every (service, namespace) subscriber of "analysis" logged config.read_coverage in every 6 h bin
    And it is in the signed allowlist with the sha256 of its value
    When the dead-row migration runs
    Then the row is removed from config.config_values and preserved in config.config_values_premigration_296
    And exactly one audit row records the deletion with new_value NULL
    And ListKeys for namespace "analysis" in staging no longer lists "opportunity.sparkline_bars"

  @AC-2 @FR-2 @feature-305
  Scenario: A signed tuple that matches no row is reported, not raised
    Given the signed allowlist holds a tuple for "marketdata" / "alpaca.paper" in production
    And the production row's value no longer hashes to the signed sha256
    When the dead-row migration runs
    Then it succeeds and the row is left in place
    And config.config_keys_report_296 holds one "unmatched-signed-tuple" row for it without a value

  @AC-6 @FR-1 @feature-305
  Scenario: Replay deletes nothing and the down restores the rows
    Given the dead-row migration has run
    When it runs a second time
    Then no further row is deleted and no further audit row is written
    And running its down re-inserts the four snapshotted rows without touching any other row
