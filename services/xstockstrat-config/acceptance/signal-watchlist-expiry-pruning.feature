# Promoted from docs/roadmap/features/281-signal-watchlist-expiry-pruning/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-281 added.
# Durable business rules xstockstrat-config guarantees for the seed of the signal prune-interval key.

Feature: xstockstrat-config — signal watchlist prune-interval seed
  The portfolio prune-interval key is seeded per environment as a global row, and rollback removes only those global rows.

  # ─── feature 296: stored keys are namespace-relative ───
  # Feature 296 (operator-signed C-16 CHANGE, davcs86 2026-11-07, 296 context.md) renames every stored key to the
  # namespace-relative form. The scenarios below are left unedited; read each listed one as follows:
  #  - 281 @AC-19: seed/stored-key Thens read 'relative, since migration R (feature 296)'.

  @AC-19 @FR-5 @feature-281
  Scenario: The prune-interval key is seeded per environment as a global row and rollback removes only those global rows
    Given config migration "037_portfolio_signal_prune_interval"
    Then its up migration's only statement inserts exactly two rows into config.config_values, one for "staging" and one for "production"
    And each row has namespace "portfolio", key "portfolio.watchlist.signal_prune_interval_seconds", value_type "int", value_data "300" equal to default_value, consuming_service "xstockstrat-portfolio" and user_id NULL
    And the insert ends with ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING, so an existing row for that scope is left unchanged
    And its down migration's only statement deletes rows where namespace is "portfolio", key is "portfolio.watchlist.signal_prune_interval_seconds" and user_id IS NULL, so per-user rows of the key survive rollback
