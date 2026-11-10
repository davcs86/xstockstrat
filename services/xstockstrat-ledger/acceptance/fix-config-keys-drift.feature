# Promoted from docs/roadmap/features/295-fix-config-keys-drift/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-295` tag.
# Durable business rule xstockstrat-ledger guarantees for config read-key recording.

Feature: xstockstrat-ledger - config read-key recording
  What xstockstrat-ledger guarantees: runtime config reads are recorded for each key the service reads.

  @AC-15 @FR-6 @regression @feature-295
  Scenario: Ledger records the runtime reads of its config keys
    When the migrations run and ledger reads "export.enabled" twice
    Then ledger logs exactly one read-key record for "ledger" / "export.enabled" before its next coverage tick
    And at that tick it logs one read-coverage record for "ledger" and re-emits that read-key record
