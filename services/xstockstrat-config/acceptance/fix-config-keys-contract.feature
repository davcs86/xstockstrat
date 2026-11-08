# Promoted from docs/roadmap/features/296-fix-config-keys-contract/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-296` tag.
# Durable business rules xstockstrat-config guarantees for the namespace-relative stored key: write rejection, rename and CHECK migrations, and alias-served rollout.

Feature: xstockstrat-config - namespace-relative stored keys (contract)
  What xstockstrat-config guarantees: a stored key never repeats its namespace, the rename and CHECK migrations preserve values, audit and ordering and stop before any write on ambiguity, and previous-image readers keep their values through the alias.

  @AC-1 @FR-1 @regression @feature-296
  Scenario: A stored key never repeats its namespace
    Given the config database after all migrations
    When a row is inserted directly with namespace "marketdata" and key "marketdata.backfill.batch_size"
    Then the insert is rejected by the database check constraint
    And SetConfig by an admin with namespace "marketdata" and key "marketdata.backfill.batch_size" returns INVALID_ARGUMENT
    And create_key with namespace "marketdata" and key "marketdata.backfill.batch_size" returns INVALID_ARGUMENT
    And GetSecret by an allow-listed caller for namespace "marketdata" and key "marketdata.alpaca.api_key" returns INVALID_ARGUMENT

  @AC-3 @FR-4 @regression @feature-296
  Scenario: A previous-image consumer keeps its values during the rollout
    Given the rename migration has run and marker row "relative_keys_v1" exists in config.config_markers
    And a previous-image consumer still reads "indicators.sandbox.timeout_ms" under namespace "indicators"
    And the stored value is 15000
    When it receives a WatchConfig snapshot for namespace "indicators"
    Then the getter returns 15000, not its code default 5000

  @AC-4 @FR-4 @regression @feature-296
  Scenario: Rolling back to the previous images after the rename keeps stored values
    Given the rename migration has run, marker row "relative_keys_v1" exists, and "trading" / "risk.bracket_orders_enabled" is stored as false
    When the deployment is rolled back to feature 295's images without running the down migration
    Then the trading image reads "trading.risk.bracket_orders_enabled" as false, not its code default true

  @AC-5 @FR-1 @regression @feature-296
  Scenario: The previous-image reconciliation poller can still escalate during rollout
    Given the trading poller sends SetConfig "platform" / "platform.trading_state" = "REDUCE_ONLY" as internal caller "trading-reconciliation-poller"
    When the contract config server handles it
    Then the row "platform" / "trading_state" holds "REDUCE_ONLY"
    And a WARN records the canonicalised internal-caller key
    And the same caller writing "ACTIVE" is still denied

  @AC-8 @FR-3 @regression @feature-296
  Scenario: The rename migration strips the prefix, activates the alias and orders its side effects
    Given namespace "marketdata" stores key "marketdata.backfill.batch_size" = 500 as int in the global scope
    When the rename migration runs
    Then namespace "marketdata" stores key "backfill.batch_size" = 500 and no key beginning with "marketdata." remains
    And config.config_markers holds marker "relative_keys_v1" with set_by "system:config-migration-" followed by the rename migration's number
    And config.config_values_premigration_296 holds the pre-rename row with a snapshot_at earlier than the rename audit row's changed_at
    And a LISTEN session on "config_changed" receives the per-(namespace, environment) notification and the {"marker":"relative_keys_v1"} notification only after the rows and the marker are committed

  @AC-9 @FR-3 @regression @feature-296
  Scenario: Twins resolve to the loser named in the signed allowlist, in every scope
    Given namespace "indicators" stores both "sandbox.timeout_ms" = 5000 and "indicators.sandbox.timeout_ms" = 15000 in the global scope
    And the signed allowlist names "sandbox.timeout_ms" with the sha256 of "5000" as the loser
    And user "u-100" has a per-user row "indicators" / "indicators.sandbox.timeout_ms" = 20000
    When the rename migration runs
    Then the global row "sandbox.timeout_ms" holds 15000 and the 5000 twin is preserved in the snapshot table
    And user "u-100" has a per-user row "sandbox.timeout_ms" = 20000

  @AC-15 @FR-1 @regression @feature-296
  Scenario: The CHECK migration re-strips a prefixed row that arrived in the rollout gap
    Given the rename migration has run
    And a previous-image config server then inserts "marketdata" / "marketdata.backfill.batch_size" through create_key with no relative twin
    When the CHECK migration runs
    Then the row is stored as "marketdata" / "backfill.batch_size" and ADD CONSTRAINT succeeds

  @AC-16 @FR-3 @regression @feature-296
  Scenario: A renamed row keeps its last-modified metadata
    Given namespace "analysis" stores key "analysis.backtest.max_range_days" with updated_by "alice" and a known updated_at
    When the rename migration runs
    Then the row "backtest.max_range_days" keeps updated_by "alice" and the same updated_at
    And ListKeys returns the same updatedAt for it
    And exactly one rename audit row exists for the row

  @AC-17 @FR-1 @regression @feature-296
  Scenario: A gap twin is resolved so the newest write wins
    Given staging global gap twins after the rename migration:
      | relative row                         | prefixed row                                   | prefixed row written by          | newer row |
      | analysis backtest.extra_knob = 1     | analysis analysis.backtest.extra_knob = 2      | an operator                      | prefixed  |
      | platform trading_state = ACTIVE      | platform platform.trading_state = REDUCE_ONLY  | trading-reconciliation-poller    | prefixed  |
      | analysis backtest.keep_knob = 7      | analysis analysis.backtest.keep_knob = 6       | an operator                      | relative  |
      | analysis backtest.null_knob = 3      | analysis analysis.backtest.null_knob = 9       | a NULL author                    | prefixed  |
      | analysis backtest.seed_knob = 3      | analysis analysis.backtest.seed_knob = 9       | system:config-migration-043      | prefixed  |
    When the CHECK migration runs
    Then backtest.extra_knob = 2 and trading_state = REDUCE_ONLY, each keeping the prefixed row's updated_by, caller_identity and updated_at
    And backtest.keep_knob = 7
    And backtest.null_knob = 3 and backtest.seed_knob = 3
    And every losing row is deleted with exactly one delete-audit row, and every winning prefixed row has exactly one rename-audit row with its delete before its rename
    And the CHECK migration does not raise and the audit trigger config_value_audit is enabled afterwards
    And a gap twin where exactly one member is a secret makes the CHECK migration raise naming namespace, key and environment, and nothing changes

  @AC-18 @FR-3 @regression @feature-296
  Scenario: A secret-class twin is never resolved automatically
    Given namespace "marketdata" stores both "fmp.api_key" and "marketdata.fmp.api_key", one of them a secret
    When the rename migration runs
    Then it raises with a line "secret-class-twin marketdata/fmp.api_key/<env>" and no value text
    And no row, snapshot row, audit row or report row is written and the marker is not set

  @AC-19 @FR-3 @regression @feature-296
  Scenario: An unsigned or stale twin stops the migration before any write and recovery converges
    Given namespace "analysis" stores both "fundsignal.valid_days" = 45 and "analysis.fundsignal.valid_days" = 90 in staging and no signed tuple is attached to the twin
    When the committed rename migration runs
    Then it raises "feature 296: <N> violation(s); nothing changed" with one line per violation, including the line "uncovered-twin analysis/fundsignal.valid_days/staging"
    And the database is dirty at the rename migration's version and counts are unchanged
    And after an operator deletes the unread duplicate with a hand-written audit row and re-applies the migrations from the previous version, the run succeeds and the migration file's sha256 is unchanged
    And a tuple whose hash matches neither member makes it raise "stale-signature", and several tuples attached to one twin make it raise "ambiguous-signature"

  @AC-20 @FR-3 @regression @feature-296
  Scenario: A per-user row stored in a spelling nobody reads is parked, not applied
    Given staging holds the per-user relative row "analysis" / "fundsignal.min_conviction_to_emit" for user "u-295", beside a global twin that migration 041 kept, and 041 reported it as per-user-unread
    When the rename migration runs
    Then the per-user row is snapshotted with its value, removed with an audit row, and listed in config.config_keys_report_296 as "per-user-parked" without a value
    And user "u-295" has the same effective value as before
    And a per-user prefixed row that is the read spelling beside a global twin is renamed, not parked

  @AC-21 @FR-3 @regression @feature-296
  Scenario: A signed tuple that attaches to no twin is reported, not raised
    Given the signed allowlist holds 5 tuples that name staging twins
    And the database is a fresh database with no twins
    When the rename migration runs
    Then it succeeds and config.config_keys_report_296 holds exactly 5 "unmatched-signed-tuple" rows without values
