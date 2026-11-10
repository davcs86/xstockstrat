Feature: fix-read-path-owner-trust (bug fix)
  Regression guard for clustered defect reports: read and consume paths scope ownership to the
  trusted x-user-id header, never to a body field or a placeholder identity.

  # guards: docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md
  @AC-1 @regression
  Scenario: A non-admin ListOrders with an empty body user_id returns only the caller's orders
    Given trading holds orders for users "user-a" and "user-b"
    When an internal caller sends ListOrders with an empty user_id and x-user-id "user-a" and x-access-scope "3" (ADMIN bit 0x04 unset)
    Then only "user-a"'s orders are returned
    And the same holds for StreamOrderUpdates

  # guards: docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md
  @AC-2 @regression
  Scenario: Broker-account identity is never filed under a placeholder owner
    Given a RegisterBrokerAccount call with no x-user-id metadata
    When trading handles the call
    Then the call is rejected and no broker account is persisted
    And when portfolio consumes an account.positions.synced, account.balance.synced or account.deregistered event with user_id ""
    Then the event is acked, logged and skipped
    And no portfolio row is written or purged under user_id "default"

  # guards: docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md
  @AC-3 @regression
  Scenario: ListAlerts without x-user-id is rejected and a body userId is ignored
    Given alerts targeted to users "user-a" and "user-b"
    When NotifyService.ListAlerts is called over mTLS with no x-user-id metadata
    Then the call is rejected with INVALID_ARGUMENT or UNAUTHENTICATED
    And when it is called with x-user-id "user-a" and body userId "user-b"
    Then no alert targeted to "user-b" is returned
