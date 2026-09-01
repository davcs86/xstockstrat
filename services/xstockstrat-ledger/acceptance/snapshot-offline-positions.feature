# Promoted from docs/roadmap/features/163-snapshot-offline-positions/acceptance.feature
# Source: @AC-10 — ledger service scenario (NEW acceptance directory for xstockstrat-ledger)
Feature: snapshot-offline-positions (ledger)
  Acceptance scenarios for the xstockstrat-ledger service promoted from feature 163.
  Covers the append-only audit ledger event emitted on every snapshot write.

  @AC-10 @FR-6 @feature-163
  Scenario: A snapshot write emits an append-only audit ledger event
    Given an OFFLINE account "acc-1"
    When snapshot_positions is called with client_snapshot_id "33333333-3333-5333-8333-333333333333" and as_of "2026-07-31T23:59:59Z"
    Then a ledger event of type "account.positions.baseline_set" is appended on stream key "account:acc-1" carrying account_id, user_id, client_snapshot_id "33333333-3333-5333-8333-333333333333", and as_of
