# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (ledger)

  @AC-27 @FR-8 @feature-294
  Scenario: Listener health is exposed as a gauge and a reconnect counter
    Given the ledger LISTEN connection drops and reconnects after 2 seconds
    When the notifier reconnects
    Then gauge "ledger.notify.listener_up" is 0 while disconnected and 1 after reconnect
    And "ledger.notify.listener_reconnects" increases by 1

  @AC-40 @FR-14 @feature-294
  Scenario: A reconnect storm logs the first failure and every Nth, at the same retry interval
    Given the ledger notifier fails to connect 30 times in a row with reconnectDelayMs 2000
    When the failures occur
    Then fewer than 30 warn lines are written and the first failure is among them
    And only the 1st, 10th, 20th and 30th consecutive failures write a warn line, each carrying consecutive_failures
    And each retry still happens 2000 ms after the previous attempt
    And after a successful connect the next failure logs again as consecutive_failures 1
