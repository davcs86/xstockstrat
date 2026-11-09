# Promoted from docs/roadmap/features/282-filter-otc-symbols/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-282 added.
# Durable business rules xstockstrat-config guarantees for the seeded filter-otc-symbols config keys.

Feature: xstockstrat-config — filter OTC symbols config seeds
  The two keys introduced by the feature are seeded at their code defaults by migrations.

  # ─── feature 296: stored keys are namespace-relative ───
  # Feature 296 (operator-signed C-16 CHANGE, davcs86 2026-11-07, 296 context.md) renames every stored key to the
  # namespace-relative form. The scenarios below are left unedited; read each listed one as follows:
  #  - 282 @AC-27: seed/stored-key Thens read 'relative, since migration R (feature 296)'.

  @AC-27 @FR-1 @FR-5 @feature-282
  Scenario: Both new keys are seeded at their code defaults by config migrations
    Given config migrations 038_marketdata_asset_refresh_interval and 039_portfolio_servability_timeout
    When their up and down files are parsed
    Then each up inserts exactly one global staging row and one global production row for its key, insert-if-absent
    And marketdata.assets.refresh_interval_hours is seeded as int 6 for xstockstrat-marketdata, inside [1,24]
    And portfolio.marketdata.servability_timeout_ms is seeded as int 2000 for xstockstrat-portfolio, inside [500,4000]
    And each down deletes only the global rows of its key, leaving per-user overrides
