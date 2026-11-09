Feature: fix-config-keys-contract (bug fix, Release B — contract)
  Cutover of stored config keys to the namespace-relative canonical form (operator decision 1 of feature 295).
  Scenario IDs are append-only (C-15). Retired IDs are kept as comments and never reused.
  Amended at design approval 2026-11-07 (context.md rounds 2-5): FR-2 and FR-9 moved to features 304 and 305.

  # RETIRED AC-2 (FR-2, moved to feature 304): consumer resolves a relative key under its subscribed namespace.
  # RETIRED AC-7 (FR-9, moved to feature 305): a dead row is deleted only with static and runtime evidence.
  # RETIRED AC-13 (FR-9, moved to feature 305): a row is kept when a subscriber's coverage log is missing.
  # RETIRED AC-14 (FR-9, moved to feature 305): a namespace with a UI reader is never proven dead.
  # Each retirement is recorded in context.md. The IDs are not reused.

  @AC-1 @FR-1 @regression
  Scenario: A stored key never repeats its namespace
    Given the config database after all migrations
    When a row is inserted directly with namespace "marketdata" and key "marketdata.backfill.batch_size"
    Then the insert is rejected by the database check constraint
    And SetConfig by an admin with namespace "marketdata" and key "marketdata.backfill.batch_size" returns INVALID_ARGUMENT
    And create_key with namespace "marketdata" and key "marketdata.backfill.batch_size" returns INVALID_ARGUMENT
    And GetSecret by an allow-listed caller for namespace "marketdata" and key "marketdata.alpaca.api_key" returns INVALID_ARGUMENT

  @AC-3 @FR-4 @regression
  Scenario: A previous-image consumer keeps its values during the rollout
    Given the rename migration has run and marker row "relative_keys_v1" exists in config.config_markers
    And a previous-image consumer still reads "indicators.sandbox.timeout_ms" under namespace "indicators"
    And the stored value is 15000
    When it receives a WatchConfig snapshot for namespace "indicators"
    Then the getter returns 15000, not its code default 5000

  @AC-4 @FR-4 @regression
  Scenario: Rolling back to the previous images after the rename keeps stored values
    Given the rename migration has run, marker row "relative_keys_v1" exists, and "trading" / "risk.bracket_orders_enabled" is stored as false
    When the deployment is rolled back to feature 295's images without running the down migration
    Then the trading image reads "trading.risk.bracket_orders_enabled" as false, not its code default true

  @AC-5 @FR-1 @regression
  Scenario: The previous-image reconciliation poller can still escalate during rollout
    Given the trading poller sends SetConfig "platform" / "platform.trading_state" = "REDUCE_ONLY" as internal caller "trading-reconciliation-poller"
    When the contract config server handles it
    Then the row "platform" / "trading_state" holds "REDUCE_ONLY"
    And a WARN records the canonicalised internal-caller key
    And the same caller writing "ACTIVE" is still denied

  @AC-6 @FR-5 @regression
  Scenario: The gate rejects a prefixed read of a seeded relative key
    Given namespace "ledger" seeds the relative key "export.max_window_days"
    And a fixture reader of namespace "ledger" calling getInt("ledger.export.max_window_days")
    When the config-wiring gate runs with --final and no baseline entry covers it
    Then it reports a prefixed-read finding for ledger / ledger.export.max_window_days and exits non-zero

  @AC-8 @FR-3 @regression
  Scenario: The rename migration strips the prefix, activates the alias and orders its side effects
    Given namespace "marketdata" stores key "marketdata.backfill.batch_size" = 500 as int in the global scope
    When the rename migration runs
    Then namespace "marketdata" stores key "backfill.batch_size" = 500 and no key beginning with "marketdata." remains
    And config.config_markers holds marker "relative_keys_v1" with set_by "system:config-migration-" followed by the rename migration's number
    And config.config_values_premigration_296 holds the pre-rename row with a snapshot_at earlier than the rename audit row's changed_at
    And a LISTEN session on "config_changed" receives the per-(namespace, environment) notification and the {"marker":"relative_keys_v1"} notification only after the rows and the marker are committed

  @AC-9 @FR-3 @regression
  Scenario: Twins resolve to the loser named in the signed allowlist, in every scope
    Given namespace "indicators" stores both "sandbox.timeout_ms" = 5000 and "indicators.sandbox.timeout_ms" = 15000 in the global scope
    And the signed allowlist names "sandbox.timeout_ms" with the sha256 of "5000" as the loser
    And user "u-100" has a per-user row "indicators" / "indicators.sandbox.timeout_ms" = 20000
    When the rename migration runs
    Then the global row "sandbox.timeout_ms" holds 15000 and the 5000 twin is preserved in the snapshot table
    And user "u-100" has a per-user row "sandbox.timeout_ms" = 20000

  @AC-10 @FR-6 @regression
  Scenario: config-ui and the agent show the FQN and write relative keys
    Given namespace "marketdata" stores key "backfill.batch_size"
    When an operator opens /config-ui for namespace "marketdata" and the agent runs list_config_keys
    Then both display "marketdata.backfill.batch_size"
    And saving a new value from config-ui, or calling set_config, sends key "backfill.batch_size" with namespace "marketdata"

  @AC-11 @FR-7 @regression
  Scenario: The contract documents state the relative convention with the alias caveat
    Given the contract release is complete
    When docs/sdd/constitution.md C-05, services/xstockstrat-config/docs/context-constitution.md CONFIG-8 and CONFIG-9, docs/context-constitution.md PLAT-14, docs/patterns/config-governance.md, the root CLAUDE.md and services/xstockstrat-config/CLAUDE.md are read
    Then each states that the stored key is namespace-relative, that the FQN is display-only, and that readers may still use the prefixed spelling via the alias until the consumer feature's baseline is empty
    And docs/runbooks/config-rollout.md states that rolling back past feature 295 is forbidden and documents the per-platform failure and recovery path
    And the config-wiring --doc-check passes

  @AC-12 @FR-8 @regression
  Scenario: The alias-removal follow-up feature exists
    Given this feature is code-completed
    When docs/roadmap/features is listed
    Then a feature directory exists whose product-spec.md removes the alias, the write tolerance and the internal-caller exception
    And its product spec declares "Depends on" this feature

  @AC-15 @FR-1 @regression
  Scenario: The CHECK migration re-strips a prefixed row that arrived in the rollout gap
    Given the rename migration has run
    And a previous-image config server then inserts "marketdata" / "marketdata.backfill.batch_size" through create_key with no relative twin
    When the CHECK migration runs
    Then the row is stored as "marketdata" / "backfill.batch_size" and ADD CONSTRAINT succeeds

  @AC-16 @FR-3 @regression
  Scenario: A renamed row keeps its last-modified metadata
    Given namespace "analysis" stores key "analysis.backtest.max_range_days" with updated_by "alice" and a known updated_at
    When the rename migration runs
    Then the row "backtest.max_range_days" keeps updated_by "alice" and the same updated_at
    And ListKeys returns the same updatedAt for it
    And exactly one rename audit row exists for the row

  @AC-17 @FR-1 @regression
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

  @AC-18 @FR-3 @regression
  Scenario: A secret-class twin is never resolved automatically
    Given namespace "marketdata" stores both "fmp.api_key" and "marketdata.fmp.api_key", one of them a secret
    When the rename migration runs
    Then it raises with a line "secret-class-twin marketdata/fmp.api_key/<env>" and no value text
    And no row, snapshot row, audit row or report row is written and the marker is not set

  @AC-19 @FR-3 @regression
  Scenario: An unsigned or stale twin stops the migration before any write and recovery converges
    Given namespace "analysis" stores both "fundsignal.valid_days" = 45 and "analysis.fundsignal.valid_days" = 90 in staging and no signed tuple is attached to the twin
    When the committed rename migration runs
    Then it raises "feature 296: <N> violation(s); nothing changed" with one line per violation, including the line "uncovered-twin analysis/fundsignal.valid_days/staging"
    And the database is dirty at the rename migration's version and counts are unchanged
    And after an operator deletes the unread duplicate with a hand-written audit row and re-applies the migrations from the previous version, the run succeeds and the migration file's sha256 is unchanged
    And a tuple whose hash matches neither member makes it raise "stale-signature", and several tuples attached to one twin make it raise "ambiguous-signature"

  @AC-20 @FR-3 @regression
  Scenario: A per-user row stored in a spelling nobody reads is parked, not applied
    Given staging holds the per-user relative row "analysis" / "fundsignal.min_conviction_to_emit" for user "u-295", beside a global twin that migration 041 kept, and 041 reported it as per-user-unread
    When the rename migration runs
    Then the per-user row is snapshotted with its value, removed with an audit row, and listed in config.config_keys_report_296 as "per-user-parked" without a value
    And user "u-295" has the same effective value as before
    And a per-user prefixed row that is the read spelling beside a global twin is renamed, not parked

  @AC-21 @FR-3 @regression
  Scenario: A signed tuple that attaches to no twin is reported, not raised
    Given the signed allowlist holds 5 tuples that name staging twins
    And the database is a fresh database with no twins
    When the rename migration runs
    Then it succeeds and config.config_keys_report_296 holds exactly 5 "unmatched-signed-tuple" rows without values

  @AC-22 @FR-5 @regression
  Scenario: A key read relative by one family and prefixed by another keeps the gate green once baselined
    Given namespace "ledger" seeds the relative key "export.max_window_days"
    And one reader reads "export.max_window_days" and another reads "ledger.export.max_window_days"
    When the config-wiring gate runs
    Then it reports exactly one prefixed-read finding and no read-unseeded finding
    And with that finding baselined under owner "feature 304", "--final" exits 0

  @AC-23 @FR-5 @regression
  Scenario: The prefixed-read baseline only shrinks
    Given scripts/config-wiring.json holds a prefixed-read entry owned by "feature 304" that covers the read of "ledger.export.max_window_days"
    When "--final" runs
    Then it exits 0 for the covered read
    And once the reader is rewritten to "export.max_window_days" the leftover entry is reported STALE and "--final" exits non-zero

  @AC-24 @FR-5 @regression
  Scenario: The inverse direction and unseeded keys stay visible
    Given namespace "ledger" seeds the prefixed key "ledger.export.enabled" and a reader reads the relative "export.enabled"
    When the config-wiring gate runs
    Then it reports a form-mismatch, and when a second reader reads "ledger.export.enabled" the relative read is still reported, as read-unseeded
    And a prefixed read of an unseeded key is reported only as read-unseeded
    And a prefixed read of a secret or prefix-catalog key is not reported
