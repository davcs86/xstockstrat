# Promoted from docs/roadmap/features/295-fix-config-keys-drift/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-295` tag.
# Durable business rules xstockstrat-config guarantees for key canonicalisation, heal migrations, seeding, change-feed liveness and the inventory tool.

Feature: xstockstrat-config - config key canonicalisation, heal and seed parity
  What xstockstrat-config guarantees: a stored key is namespace-relative (the FQN is display-only), every read key is seeded, heals never destroy intent silently, and secrets are never printed.

  # ─── feature 296: stored keys are namespace-relative ───
  # Feature 296 (operator-signed C-16 CHANGE, davcs86 2026-11-07, 296 context.md) renames every stored key to the
  # namespace-relative form. The scenarios below are left unedited; read each listed one as follows:
  #  - 295 @AC-1, @AC-25: a prefixed SetConfig/create_key/GetSecret key is rejected INVALID_ARGUMENT (feature 296 @AC-1); the previous-image reconciliation poller's prefixed trading_state was canonicalised with a WARN (feature 296 @AC-5) until feature 306 (operator-signed C-16 CHANGE, davcs86 2026-11-10): the exception is gone, a prefixed trading_state is INVALID_ARGUMENT, and the grant matches the exact key `trading_state` (295 @AC-25); request keys are namespace-relative.
  #  - 295 @AC-14, @AC-21, @AC-26: seed/stored-key Thens read 'relative, since migration R (feature 296)'; key literals are the stored relative key.
  #  - 295 @AC-34: superseded by feature 296 @AC-1 — the prefixed spelling is rejected before the ambiguity probe and the key CHECK (R+1) forbids a prefixed row, so no twin can be written; feature 306 (operator-signed C-16 CHANGE, davcs86 2026-11-10) removed the probe and the ambiguity FAILED_PRECONDITION: SetConfig has no ambiguity branch and a relative key updates exactly its row.
  #  - 295 @AC-28(a)(b)(c): the mechanism is `migrate goto <R-1>` plus a direct dirty-guard call that exits 3 (feature 296 rerun passes 2b/2c).
  #  - 295 @AC-5 (PRESERVED): survives 041; feature 296 R parks the per-user row with a snapshot and a `per-user-parked` report row; the user's effective value is unchanged.
  #  - 295 @AC-33 (PRESERVED): R and R+1 never delete a secret-class twin; the CI fixture twin is deleted by the repair step of the rerun, never by a migration.

  @AC-1 @FR-1 @regression @feature-295
  Scenario: SetConfig with either spelling updates the row the service reads
    Given staging stores "marketdata" / "marketdata.backfill.batch_size" = 1000 as int
    When an admin calls SetConfig with namespace "marketdata" and key "backfill.batch_size" and value 500
    Then the row "marketdata.backfill.batch_size" holds 500
    And no row "backfill.batch_size" exists in namespace "marketdata"
    And when user "u-1" sets "marketdata" / "backfill.batch_size" = 700 for themselves, a per-user "marketdata.backfill.batch_size" row holds 700 and the global row still holds 500

  @AC-2 @FR-1 @preserve @feature-295
  # Preserve-guard (C-15): green on today's code by design; it must stay green once the dormant alias ships.
  Scenario: Without the rename marker the snapshot carries only stored spellings
    Given no key-rename marker exists in the config database
    When a subscriber receives the WatchConfig snapshot for namespace "indicators"
    Then the snapshot keys are exactly the stored keys of namespace "indicators"

  @AC-3 @FR-3 @regression @feature-295
  Scenario: An unread twin created by seeding is removed and its intent is reported, not applied
    Given a staging "analysis" row "fundsignal.enabled" = true that no reader consumes
    And the reader consumes "analysis.fundsignal.enabled", which has no row
    And the row's sha256 tuple is in the signed allowlist
    When the heal migrations run
    Then "analysis" / "analysis.fundsignal.enabled" exists with value false, the reader's code default
    And "analysis" / "fundsignal.enabled" no longer exists and is preserved in the premigration snapshot table
    And the heal report lists "analysis fundsignal.enabled: stored true, effective false"

  @AC-4 @FR-3 @regression @feature-295
  Scenario: When both spellings exist, the row the code reads wins
    Given staging "analysis" rows "backtest.max_duration_seconds" = 300 and "analysis.backtest.max_duration_seconds" = 60
    And the unread row's sha256 tuple is in the signed allowlist
    When the heal migrations run
    Then exactly one row remains for that key, "analysis.backtest.max_duration_seconds" = 60
    And a config_audit row records the deletion of "backtest.max_duration_seconds"

  @AC-5 @FR-3 @regression @feature-295
  Scenario: A per-user row in an unread spelling is snapshotted and reported, not silently applied
    Given user "u-295" has a staging "analysis" row "fundsignal.enabled" = true
    And its sha256 tuple is not in the signed allowlist
    When the heal migrations run
    Then that per-user row survives unchanged
    And the heal report lists it with user "u-295"
    And user "u-295"'s effective "analysis.fundsignal.enabled" is unchanged

  @AC-14 @FR-5 @regression @feature-295
  Scenario: Every read key has a complete seed row in both environments
    Given the config database after all migrations
    When "identity" / "identity.jwt.access_ttl_seconds" is listed with ListKeys in staging and in production
    Then each environment returns value_type "int", default_value "900", a non-empty description and consuming_service "xstockstrat-identity"

  @AC-21 @FR-2 @regression @feature-295
  Scenario: A silently dead config-server change feed is detected and recovered
    Given the config server's LISTEN connection stops delivering notifications without closing
    And an operator then sets "indicators" / "indicators.sandbox.timeout_ms" to 15000
    When the server's change-feed heartbeat deadline elapses
    Then the server reconnects its LISTEN feed and resyncs
    And the indicators subscriber receives 15000

  @AC-22 @FR-4 @regression @feature-295
  Scenario: The inventory tool never prints secret material
    Given the config database holds secret row "marketdata" / "alpaca.api_key"
    When the operator runs the inventory tool from the indicators DO console
    Then the output lists that row's namespace, key, environment, value_type and is_secret
    And the output contains no value_encrypted bytes and no plaintext secret value

  @AC-24 @FR-5 @regression @feature-295
  Scenario: A row whose stored value differs from the code default is not retyped
    Given a migration-assertion fixture row "trading" / "trading.order.max_retries" stored as string "7" whose reader is an int getter with code default 3
    When the seed-parity migration runs
    Then that row's value_type and value_data are unchanged
    And the sign-off report lists "trading trading.order.max_retries: stored string 7, reader int default 3"

  @AC-25 @FR-1 @regression @feature-295
  Scenario: Internal-caller grants and write bounds match on the canonical key
    Given the grant for "trading-reconciliation-poller" on "platform" / "platform.trading_state"
    When that caller sends SetConfig "platform" / "trading_state" = "REDUCE_ONLY"
    Then the stored "platform.trading_state" row holds "REDUCE_ONLY"
    And SetConfig "analysis" / "opportunity.max_universe_size" = 0 by an admin returns INVALID_ARGUMENT from the [1,1000] bound

  @AC-26 @FR-2 @regression @feature-295
  Scenario: A no-op reload or re-send does not report a config change
    Given a subscriber of namespace "ledger" that counts distinct snapshot versions
    When the server runs its periodic full reload and its liveness re-send with no row changed
    Then the subscriber observes no new snapshot version
    And when an operator then sets "ledger" / "ledger.export.max_window_days" to 180 it observes exactly one new version

  @AC-28 @FR-3 @regression @feature-295
  Scenario: Replaying the heal after a later key was created never deletes that key
    Given the heal migration has already run
    And an operator then created "analysis" / "backtest.extra_knob" in a spelling no reader uses
    When the heal is re-run by "migrate force 35" plus "scripts/db-migrate.sh up", with the latch present and with it removed
    Then "analysis" / "backtest.extra_knob" still exists
    And the latest run deletes no row, and with the latch present adds no report or audit row
    And an automatic force 0 from a dirty 036 fails at migration 001 leaving row counts and audit functions unchanged, after which the probe-and-force runbook converges

  @AC-29 @FR-5 @regression @feature-295
  Scenario: A key whose readers disagree on the default is not seeded
    Given a config database whose production "platform" / "platform.trading_state" row was deleted before the heal
    And trading's code default is "HALTED" while the UI's is no restriction
    When the seed-parity migration runs
    Then no "platform.trading_state" row is created in production
    And the heal report lists "platform platform.trading_state: readers disagree on default"

  @AC-30 @FR-4 @regression @feature-295
  Scenario: The inventory commits hashes, with plaintext only for sign-off rows
    Given non-secret staging row "analysis" / "analysis.opportunity.max_universe_size" = 100 that is not on the sign-off list
    And non-secret row "analysis" / "fundsignal.enabled" = true that is on the sign-off list
    When the operator runs the inventory tool
    Then the output for the first row carries sha256 of its value_data and not "100"
    And the output for the second row carries plaintext "true"
    And the output ends with an output digest and the sha256 of the tool's own source

  @AC-31 @FR-12 @regression @feature-295
  Scenario: The derived deadline never exceeds the long-RPC budget
    Given an admin sets "indicators" / "indicators.sandbox.timeout_ms" to 40000
    Then SetConfig returns INVALID_ARGUMENT from the [100,33000] bound
    And with timeout 33000 and grace 10000 the agent derives a test_formula deadline of 45 seconds

  @AC-33 @FR-3 @regression @feature-295
  Scenario: A plaintext twin of a secret key is never revealed, deleted or reported in plaintext
    Given staging holds secret row "marketdata" / "fmp.api_key" and a non-secret legacy row "marketdata" / "marketdata.fmp.api_key"
    When the inventory, the dry-run and the heal migration run
    Then the legacy row still exists and is reported "twin-secret-class"
    And its value appears in no inventory, reveal output, heal report column or snapshot value column

  @AC-34 @FR-1 @regression @feature-295
  Scenario Outline: SetConfig refuses an ambiguous spelling instead of writing a row nobody reads
    Given staging "analysis" holds <rows>
    When <caller> calls SetConfig with namespace "analysis" and key "backtest.max_duration_seconds" and value 90
    Then the call returns FAILED_PRECONDITION naming both "backtest.max_duration_seconds" and "analysis.backtest.max_duration_seconds"
    And no row changes

    Examples:
      | rows                                                                                              | caller       |
      | global rows "backtest.max_duration_seconds" = 300 and "analysis.backtest.max_duration_seconds" = 60 | an admin     |
      | global "analysis.backtest.max_duration_seconds" = 60 and a per-user "backtest.max_duration_seconds" = 300 for "u-1" | user "u-1" |

  @AC-35 @FR-1 @regression @feature-295
  Scenario: A constraint violation surfaces as INVALID_ARGUMENT
    Given an insert into config.config_values violates a table constraint
    When SetConfig performs it
    Then the call returns INVALID_ARGUMENT, not INTERNAL

  @AC-36 @FR-4 @regression @feature-295
  Scenario: The inventory tool refuses to reveal per-user, secret or secret-class rows
    Given a reveal request naming the per-user row "analysis" / "fundsignal.enabled" of user "u-295"
    When the operator runs the inventory tool with --reveal
    Then it exits with status 2 and prints no value
