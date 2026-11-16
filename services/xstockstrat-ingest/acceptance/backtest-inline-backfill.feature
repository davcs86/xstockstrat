# Promoted from docs/roadmap/features/343-backtest-inline-backfill/acceptance.feature (Constitution C-16).
# Provenance: @feature-343.

Feature: xstockstrat-ingest - TriggerBackfill admits a bounded self-serve backfill for non-admins and denies anything outside it with a reason

  @AC-7 @FR-6 @feature-343
  Scenario: A non-admin user can run the inline backfill
    Given a signed-in user without the admin scope
    And an insufficient-data result for "LYFT"
    When "Backfill missing data" is activated
    Then the backfill is accepted and its status is "QUEUED"

  @AC-15 @FR-6 @feature-343
  Scenario Outline: A non-admin request outside the self-serve envelope is denied with its reason
    Given a signed-in user without the admin scope
    When a backfill is requested that breaks the "<condition>" condition
    Then it is denied with "self-serve backfill denied: <token>"
    And no job is created

    Examples:
      | condition                         | token          |
      | exactly one symbol                | multi_symbol   |
      | bars only                         | data_kind      |
      | missing bars only                 | fill_mode      |
      | no overwrite                      | overwrite      |
      | explicit range with start < end   | range_unset    |
      | range within the self-serve limit | range_too_long |
      | no callback URL                   | callback_url   |
      | a real user id                    | no_user        |
