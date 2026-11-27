# Promoted from docs/roadmap/features/312-fix-read-path-owner-trust/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-312` tag.
# Durable business rules trading already guarantees; a rule enters only by promotion from a reviewed acceptance.feature.

Feature: xstockstrat-trading - order reads are scoped to the trusted x-user-id header
  Order read paths scope ownership to the trusted x-user-id header, never to a body field.

  # guards: docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md
  @AC-1 @regression @feature-312
  Scenario: A non-admin ListOrders with an empty body user_id returns only the caller's orders
    Given trading holds orders for users "user-a" and "user-b"
    When an internal caller sends ListOrders with an empty user_id and x-user-id "user-a" and x-access-scope "3" (ADMIN bit 0x04 unset)
    Then only "user-a"'s orders are returned
    And the same holds for StreamOrderUpdates

  # guards: docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md (design D-7, D-17)
  @AC-4 @regression @feature-312
  Scenario Outline: Order reads are scoped to x-user-id for every scope and the body user_id is ignored
    Given trading holds orders for users "user-a" and "user-b"
    When an internal caller sends <rpc> with x-user-id "user-a", x-access-scope "<scope>" and body user_id "<body>"
    Then only "user-a"'s orders are delivered

    Examples:
      | rpc                | scope | body   |
      | ListOrders         | 3     | user-b |
      | ListOrders         | 4     | user-b |
      | ListOrders         | 4     |        |
      | StreamOrderUpdates | 3     | user-b |
      | StreamOrderUpdates | 4     | user-b |
      | StreamOrderUpdates | 4     |        |

  # guards: docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md (design D-7, D-15)
  @AC-5 @regression @feature-312
  Scenario Outline: An order read with no x-user-id is refused
    Given trading holds orders for users "user-a" and "user-b"
    When an internal caller sends <rpc> with no x-user-id metadata
    Then the call fails with PERMISSION_DENIED
    And no order is delivered

    Examples:
      | rpc                |
      | ListOrders         |
      | StreamOrderUpdates |
      | GetOrder           |

  # guards: docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md (design D-15)
  @AC-6 @regression @feature-312
  Scenario Outline: GetOrder for another user's order is indistinguishable from an absent order
    Given trading holds an order owned by "user-b"
    When an internal caller sends GetOrder for that order_id with x-user-id "user-a" and x-access-scope "<scope>"
    Then the call fails with NOT_FOUND
    And the status code and message match those returned for an order_id that does not exist

    Examples:
      | scope |
      | 3     |
      | 4     |
