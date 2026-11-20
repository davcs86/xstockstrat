# Promoted from docs/roadmap/features/349-fix-replace-tif-before-intent/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-349` tag.
# Durable business rules xstockstrat-trading already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-trading — a replace with a disallowed time-in-force is refused with no side effect

  @AC-1 @FR-1 @regression @feature-349
  Scenario: A replace with a time-in-force the broker does not allow leaves nothing behind
    Given a NEW order on an IBKR account
    When its owner replaces it with time-in-force "OPG"
    Then the request is refused as an invalid argument
    And no replace intent is recorded for the order
    And the order's intent state is unchanged
    And no replace is sent to the broker
    And no intent-reclaim event is emitted for the order, however long the caller waits

  @AC-2 @FR-1 @regression @feature-349
  Scenario: The caller can correct the time-in-force and retry
    Given a NEW order on an IBKR account whose replace with time-in-force "OPG" was refused
    When its owner sends the same replace with time-in-force "DAY"
    Then the replace is sent to the broker and succeeds
    And the refused request can be sent again and is refused as an invalid argument, not as pending or unknown

  @AC-3 @FR-2 @feature-349
  Scenario: An allowed replace still claims exactly one intent
    Given a NEW order on an IBKR account
    When its owner replaces it with time-in-force "DAY"
    Then exactly one replace intent is recorded for the order and it is completed
    And an identical replace returns the stored result without a second broker call

  @AC-4 @FR-1 @regression @feature-349
  Scenario: A disallowed time-in-force is refused even when an intent for the same request exists
    Given a NEW order on an IBKR account
    And a replace intent with unknown outcome is already recorded for its replace with time-in-force "OPG"
    When its owner replaces it with time-in-force "OPG"
    Then the request is refused as an invalid argument, not as an unknown outcome
