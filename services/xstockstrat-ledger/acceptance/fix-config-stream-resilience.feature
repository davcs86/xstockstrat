# Promoted from docs/roadmap/features/258-fix-config-stream-resilience/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-258` tag.
# Durable business rules xstockstrat-ledger guarantees for idempotent AppendEvent DB failures.

Feature: xstockstrat-ledger - idempotent AppendEvent surfaces DB failures
  What xstockstrat-ledger guarantees: a pool or in-transaction failure on the idempotent append path returns a gRPC error status, releases its client, and raises no unhandled rejection.

  @AC-5 @FR-3 @regression @feature-258
  Scenario: Idempotent AppendEvent returns an error status when no pool connection can be acquired
    Given ledger pool.connect rejects with "timeout exceeded when trying to connect"
    When AppendEvent is called with stream_key "account:a-1" and idempotency_key "k-1"
    Then the callback is invoked with a gRPC error status
    And no unhandled promise rejection is raised

  @AC-10 @FR-3 @regression @feature-258
  Scenario: Idempotent AppendEvent returns an error status and releases its client when a query in the transaction fails
    Given ledger pool.connect succeeds and the INSERT inside the idempotent transaction rejects with "connection terminated"
    When AppendEvent is called with stream_key "account:a-1" and idempotency_key "k-2"
    Then the callback is invoked with a gRPC error status
    And the acquired pool client is released
    And no unhandled promise rejection is raised
