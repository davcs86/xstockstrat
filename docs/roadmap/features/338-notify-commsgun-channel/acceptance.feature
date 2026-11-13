Feature: notify-commsgun-channel
  As the platform operator, I want notify to send fanout email through the homelab commsgun hub when it is
  configured and reachable, selectable live from config-ui, so that homelab alert email gets durable delivery
  while SendGrid keeps working everywhere commsgun is not available.

  Background:
    Given an alert with severity WARNING and no conviction, which passes the fanout gates at their defaults
    And SendGrid is enabled with from "alerts@example.com" and to "ops@example.com"

  @AC-1 @FR-1 @FR-2
  Scenario: sendgrid mode never calls commsgun
    Given "notify.fanout.email_provider" is "sendgrid" and commsgun is configured
    When the alert is emitted
    Then exactly 1 SendGrid mail-send request is made
    And no outbox row is created and no request is made to the commsgun enqueue URL

  @AC-2 @FR-1 @FR-3
  Scenario: auto mode without commsgun configuration behaves as sendgrid
    Given "notify.fanout.email_provider" is "auto" and "notify.commsgun.enqueue_url" is ""
    When the alert is emitted
    Then exactly 1 SendGrid mail-send request is made
    And no outbox row is created

  @AC-3 @FR-1
  Scenario: an unrecognised provider value behaves as auto
    Given "notify.fanout.email_provider" is "mailgun" and commsgun is configured
    When the alert is emitted
    Then 1 outbox row is created in state "pending"
    And no SendGrid request is made at emit time

  @AC-4 @FR-4 @FR-5
  Scenario: auto mode with commsgun configured enqueues through the outbox
    Given "notify.fanout.email_provider" is "auto" and commsgun is configured with app id "xstockstrat-staging" and recipient "ops@example.com"
    And the commsgun stub answers 202
    When the alert is emitted and the worker runs once
    Then the stub received 1 POST with header "X-Commsgun-App: xstockstrat-staging", a Bearer authorization, an "Idempotency-Key" header and a JSON body with "channel" = "email" and "to" = ["ops@example.com"]
    And the outbox row is in state "delivered" with 1 attempt
    And no SendGrid request is made

  @AC-5 @FR-4
  Scenario: the outbox never delays or fails EmitAlert
    Given commsgun is configured and the commsgun stub does not answer for 30 seconds
    When the alert is emitted
    Then EmitAlert returns success and a StreamAlerts subscriber receives the alert before any commsgun request completes

  @AC-6 @FR-4
  Scenario: a pending row survives a restart
    Given 1 outbox row in state "pending" with 0 attempts
    When the worker is stopped, a new worker is started, and the commsgun stub answers 202
    Then the row is in state "delivered" with 1 attempt

  @AC-7 @FR-5 @FR-6
  Scenario: retries reuse the same idempotency key and body
    Given commsgun is configured and the commsgun stub answers 503 then 202
    When the alert is emitted and the worker runs until the row is delivered
    Then the stub received 2 POSTs whose "Idempotency-Key" headers are equal and whose bodies are byte-identical
    And the outbox row is in state "delivered" with 2 attempts

  @AC-8 @FR-5
  Scenario: a duplicate answer counts as delivered
    Given commsgun is configured and the commsgun stub answers 200 with body {"duplicate": true}
    When the alert is emitted and the worker runs once
    Then the outbox row is in state "delivered"

  @AC-9 @FR-6
  Scenario: 429 waits at least Retry-After
    Given commsgun is configured and the commsgun stub answers 429 with header "Retry-After: 120"
    When the alert is emitted and the worker runs once
    Then the outbox row is in state "pending" with 1 attempt and its next attempt is at least 120 seconds after the response

  @AC-10 @FR-6 @FR-7
  Scenario: a permanent status ends the row at once and auto falls back to SendGrid
    Given "notify.fanout.email_provider" is "auto", commsgun is configured, and the commsgun stub answers 401
    When the alert is emitted and the worker runs once
    Then the stub received exactly 1 POST
    And the outbox row is in a terminal undelivered state recording fallback "sendgrid"
    And exactly 1 SendGrid mail-send request is made for that alert

  @AC-11 @FR-6 @FR-7
  Scenario: exhausted attempts fall back to SendGrid exactly once
    Given "notify.fanout.email_provider" is "auto", commsgun is configured, "notify.commsgun.max_attempts" is 3, and the commsgun stub always answers 503
    When the alert is emitted and the worker runs until the row is terminal
    Then the stub received exactly 3 POSTs
    And exactly 1 SendGrid mail-send request is made for that alert

  @AC-12 @FR-7
  Scenario: commsgun mode has no fallback
    Given "notify.fanout.email_provider" is "commsgun", commsgun is configured, "notify.commsgun.max_attempts" is 3, and the commsgun stub always answers 503
    When the alert is emitted and the worker runs until the row is terminal
    Then no SendGrid request is made
    And the outbox row is in a terminal undelivered state recording no fallback

  @AC-13 @FR-8
  Scenario: an undelivered row is surfaced without re-entering email fanout
    Given "notify.fanout.email_provider" is "commsgun", commsgun is configured, "notify.commsgun.max_attempts" is 1, and the commsgun stub answers 503
    When the alert is emitted and the worker runs until the row is terminal
    Then 1 WARN log line names the alert id and the status class "5xx"
    And the undelivered counter increased by 1
    And the outbox table holds exactly 1 row

  @AC-14 @FR-9
  Scenario: the app key is resolved through GetSecret and redacted everywhere else
    Given the secret "notify" / "commsgun.app_key" is stored with value "k-0123456789abcdef0123456789abcdef"
    When GetConfig, ListKeys and WatchConfig return that key
    Then each returns the value "[redacted]"
    And GetSecret called with x-internal-caller "notify" returns "k-0123456789abcdef0123456789abcdef"
    And GetSecret called with x-internal-caller "analysis" for that key is refused with PERMISSION_DENIED

  @AC-15 @FR-9
  Scenario: a rotated app key is used without a restart
    Given commsgun is configured with app key "old-key-0123456789abcdef0123456789" and 1 alert was delivered
    When the secret is set to "new-key-0123456789abcdef0123456789" and a second alert is emitted and the worker runs once
    Then the second POST carries "Authorization: Bearer new-key-0123456789abcdef0123456789"

  @AC-16 @FR-10
  Scenario: the new keys are seeded and editable in config-ui
    Given a database migrated to the latest config migration
    When an admin opens "/config-ui" and filters the namespace "notify"
    Then "fanout.email_provider" is listed with value "auto"
    And "commsgun.app_key" is listed as a secret with value "[redacted]"
    And saving "fanout.email_provider" as "sendgrid" persists and is shown after a reload

  @AC-17 @FR-10
  Scenario: the startup channel log names commsgun
    Given commsgun is configured
    When notify starts
    Then the delivery-channels log line lists "commsgun" among enabled channels and contains neither the enqueue URL nor the app key

  @AC-18 @FR-11
  Scenario: no message content or credential reaches a log
    Given commsgun is configured with recipient "ops@example.com" and app key "k-0123456789abcdef0123456789abcdef"
    And the commsgun stub answers 503 then 422
    When an alert titled "AAPL breakout" is emitted and the worker runs until the row is terminal
    Then no captured log line contains "ops@example.com", "AAPL breakout", "k-0123456789abcdef0123456789abcdef" or the enqueue URL
