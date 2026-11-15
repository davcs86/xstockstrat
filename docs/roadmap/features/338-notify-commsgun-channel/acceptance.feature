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
    When the worker runs once with the commsgun stub answering 202
    Then the row is "delivered" and it is not rerouted

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
    And the outbox row has state "undelivered", fallback "none", and recipient, subject and text all NULL

  @AC-13 @FR-8
  Scenario: an undelivered row is surfaced without re-entering email fanout
    Given "notify.fanout.email_provider" is "commsgun", commsgun is configured, "notify.commsgun.max_attempts" is 1, and the commsgun stub answers 503
    When the alert is emitted and the worker runs until the row is terminal
    Then 1 WARN log line names the alert id and the status class "5xx"
    And notify.delivery{channel="commsgun", outcome="dead"} increased by 1
    And 1 alert with category "commsgun", severity WARNING and source "xstockstrat-notify" is persisted and delivered to a StreamAlerts subscriber
    And the outbox table holds exactly 1 row and no SendGrid request is made for the "commsgun" alert

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
    And "commsgun.app_key" is listed as a secret whose wire value is "[redacted]" and which the page shows as "[secret]"
    And saving "fanout.email_provider" as "sendgrid" persists and is shown after a reload

  @AC-17 @FR-10
  Scenario Outline: the startup channel log reflects the worker route
    Given "notify.fanout.email_provider" is "<mode>", the commsgun base is set, and the app key is <key>
    When notify starts
    Then the delivery-channels log line lists "commsgun" as <state> and contains neither the enqueue URL nor the app key

    Examples:
      | mode     | key                      | state    |
      | auto     | resolved                 | enabled  |
      | auto     | unresolved (UNAVAILABLE) | disabled |
      | commsgun | absent                   | enabled  |

  @AC-18 @FR-11
  Scenario: no message content or credential reaches a log
    Given commsgun is configured with recipient "ops@example.com" and app key "k-0123456789abcdef0123456789abcdef"
    And the commsgun stub answers 503 then 422
    When an alert titled "AAPL breakout" is emitted and the worker runs until the row is terminal
    Then no captured log line contains "ops@example.com", "AAPL breakout", "k-0123456789abcdef0123456789abcdef" or the enqueue URL

  @AC-19 @FR-3
  Scenario Outline: auto mode treats a partial commsgun configuration as not configured
    Given "notify.fanout.email_provider" is "auto" and commsgun is configured except that <missing>
    When the alert is emitted
    Then exactly 1 SendGrid mail-send request is made
    And no outbox row is created

    Examples:
      | missing                                  |
      | "notify.commsgun.app_id" is ""           |
      | "notify.commsgun.to_email" is ""         |
      | the secret "commsgun.app_key" is absent  |
      | GetSecret for "commsgun.app_key" fails   |

  @AC-20 @FR-6
  Scenario: a timeout is retried
    Given commsgun is configured, "notify.commsgun.request_timeout_seconds" is 1, and the commsgun stub answers the first POST after 3 seconds and the second with 202
    When the alert is emitted and the worker runs until the row is delivered
    Then the outbox row is in state "delivered" with 2 attempts

  @AC-21 @FR-6
  Scenario: a network error is retried
    Given commsgun is configured and the commsgun stub closes the first connection without a response and answers the second POST with 202
    When the alert is emitted and the worker runs until the row is delivered
    Then the outbox row is in state "delivered" with 2 attempts

  @AC-22 @FR-7 @FR-8
  Scenario: auto mode with SendGrid disabled ends without fallback
    Given "notify.fanout.email_provider" is "auto", commsgun is configured, "notify.commsgun.max_attempts" is 1, the commsgun stub answers 503, and (overriding the Background) SENDGRID_API_KEY is unset
    When the alert is emitted and the worker runs until the row is terminal
    Then no SendGrid request is made
    And the outbox row has state "undelivered" and fallback "none"
    And 1 alert with category "commsgun" naming the alert id is persisted

  @AC-23 @FR-8 @FR-20
  Scenario Outline: a commsgun-category alert is never emailed
    Given "notify.fanout.email_provider" is "<mode>" and commsgun is configured
    When an alert with category "commsgun" and severity WARNING is emitted
    Then no SendGrid request is made and no outbox row is created

    Examples:
      | mode     |
      | sendgrid |
      | auto     |
      | commsgun |

  @AC-24 @FR-12
  Scenario Outline: each environment sends as its own commsgun app
    Given a database migrated to the latest config migration
    And notify runs with APPLICATION_ENV "<env>" and commsgun is otherwise configured with the "<env>" secret set to "<key>"
    And the "<other>" environment's secret "commsgun.app_key" is set to "other-env-key-0123456789abcdef012345"
    And the commsgun stub answers 202
    When the alert is emitted and the worker runs once
    Then the POST carries "X-Commsgun-App: <app>" and "Authorization: Bearer <key>"

    Examples:
      | env        | other      | app                 | key                                   |
      | production | staging    | xstockstrat         | prod-key-0123456789abcdef0123456789ab |
      | staging    | production | xstockstrat-staging | stag-key-0123456789abcdef0123456789ab |

  @AC-25 @FR-3
  Scenario: commsgun mode queues without a key and retries it as no_app_key
    Given "notify.fanout.email_provider" is "commsgun", the commsgun base is set, the secret "commsgun.app_key" is absent, and "notify.commsgun.max_attempts" is 2
    When the alert is emitted and the worker runs until the row is terminal
    Then no SendGrid request is made and the stub received 0 POSTs
    And the outbox row has state "undelivered", 2 attempts and last_error "no_app_key"

  @AC-26 @FR-14
  Scenario: pinned to commsgun without a base raises one standing incident
    Given "notify.fanout.email_provider" is "commsgun" and "notify.commsgun.enqueue_url" is ""
    When 3 alerts are emitted within 1 hour and the worker ticks
    Then no outbox row is created and no SendGrid request is made
    And exactly 1 alert with category "commsgun" is persisted
    When the clock advances 24 hours and the worker ticks
    Then exactly 2 alerts with category "commsgun" are persisted

  @AC-27 @FR-13 @FR-15
  Scenario: a deliberate switch to sendgrid reroutes pending rows silently
    Given 2 outbox rows in state "pending"
    When "notify.fanout.email_provider" is set to "sendgrid" and the worker ticks twice
    Then the stub received 0 POSTs and exactly 2 SendGrid requests are made
    And both rows have state "rerouted", reroute_reason "deliberate", fallback "sendgrid" and fallback_sent_at set
    And no alert with category "commsgun" is persisted

  @AC-28 @FR-13 @FR-15
  Scenario: a deliberate switch with SendGrid disabled drops and alerts once
    Given 2 outbox rows in state "pending" and (overriding the Background) SENDGRID_API_KEY is unset
    When "notify.fanout.email_provider" is set to "sendgrid" and the worker ticks 3 times
    Then both rows have state "rerouted" and fallback "none"
    And exactly 1 alert with category "commsgun" is persisted, stating that 2 pending emails were dropped

  @AC-29 @FR-13 @FR-15
  Scenario: lost configuration in auto drains and alerts once per drain
    Given "notify.fanout.email_provider" is "auto" and 2 outbox rows in state "pending"
    When "notify.commsgun.enqueue_url" is set to "" and the worker ticks 3 times
    Then exactly 2 SendGrid requests are made and the stub received 0 POSTs
    And both rows have state "rerouted" and reroute_reason "lost_config"
    And exactly 1 alert with category "commsgun" is persisted, reporting 2 rows with fallback "sendgrid"

  @AC-30 @FR-15 @FR-7
  Scenario: a reroute interrupted before its send is alerted, never re-sent
    Given 1 outbox row with state "rerouted", reroute_reason "deliberate", fallback "sendgrid", fallback_sent_at NULL and escalated_at NULL
    When a new worker starts and ticks once
    Then no SendGrid request is made
    And exactly 1 alert with category "commsgun" reporting 1 unconfirmed fallback is persisted, and the row's escalated_at is set

  @AC-31 @FR-8
  Scenario: an undelivered row whose escalation was lost is re-raised after restart
    Given 1 outbox row with state "undelivered", fallback "sendgrid" and escalated_at NULL
    When a new worker starts and ticks once
    Then exactly 1 alert with category "commsgun" naming that row's alert id is persisted
    And no SendGrid request is made

  @AC-32 @FR-8 @FR-7
  Scenario: the escalation alert is persisted before the fallback send
    Given "notify.fanout.email_provider" is "auto", commsgun is configured and the commsgun stub answers 401
    When the alert is emitted and the worker runs once
    Then the "commsgun" alert is persisted before the SendGrid request is made
    And the row has escalated_at and fallback_sent_at both set

  @AC-33 @FR-16
  Scenario: rows are held while the key has never resolved
    Given "notify.fanout.email_provider" is "auto", the commsgun base is set, 1 outbox row in state "pending" created 3 days ago, and GetSecret fails with UNAVAILABLE
    When the worker ticks 3 times and a new alert is emitted
    Then the stub received 0 POSTs, the row has state "pending" with 0 attempts, and exactly 1 SendGrid request is made for the new alert
    When GetSecret then returns the key and the worker ticks
    Then the held row has state "delivered"

  @AC-34 @FR-15
  Scenario Outline: a stalled key raises a standing incident
    Given "notify.fanout.email_provider" is "auto", "notify.commsgun.enqueue_url" is "<url>", no outbox row exists, and the key <cond>
    When the worker ticks
    Then <n> alerts with category "commsgun" are persisted and no alert text contains the key value

    Examples:
      | url                        | cond                                | n                          |
      | https://comms.example/v1/m | is absent                           | 1                          |
      | https://comms.example/v1/m | failed once with UNAVAILABLE        | 0                          |
      | https://comms.example/v1/m | failed twice with PERMISSION_DENIED | 1 naming PERMISSION_DENIED |
      |                            | failed twice with PERMISSION_DENIED | 0                          |
      |                            | is absent                           | 0                          |

  @AC-35 @FR-15
  Scenario: the stalled-key incident repeats daily
    Given "notify.fanout.email_provider" is "auto", the commsgun base is set, the key is absent, and the stalled-key incident has alerted once
    When the clock advances 24 hours and the worker ticks
    Then exactly 2 incident alerts are persisted

  @AC-36 @FR-17
  Scenario: shutdown aborts an in-flight POST without spending an attempt
    Given commsgun is configured and the commsgun stub does not answer
    When the alert is emitted, the worker starts its POST, and SIGTERM is received
    Then the row has state "pending" with 0 attempts and no UPDATE is issued after the pool closes

  @AC-37 @FR-18
  Scenario: Retry-After is capped at backoff_max_seconds
    Given commsgun is configured, "notify.commsgun.backoff_max_seconds" is 60, and the stub answers 429 with "Retry-After: 120"
    When the alert is emitted and the worker runs once
    Then the row is "pending" with 1 attempt and its next attempt is at most 60 seconds after the response

  @AC-38 @FR-18
  Scenario Outline: causes other than HTTP errors are distinct retryable classes in commsgun mode
    Given "notify.fanout.email_provider" is "commsgun", 1 outbox row in state "pending", and at attempt time <cause>
    When the worker runs once
    Then the stub received 0 POSTs and the row is "pending" with 1 attempt and last_error "<class>"

    Examples:
      | cause                          | class             |
      | the key is absent              | no_app_key        |
      | GetSecret has never succeeded  | secret_unresolved |
      | "notify.commsgun.app_id" is "" | no_endpoint       |

  @AC-39 @FR-19
  Scenario: changing the app id with rows pending warns once
    Given 2 outbox rows in state "pending" queued for "ops@example.com" and app id "xstockstrat-staging"
    When "notify.commsgun.app_id" is set to "xstockstrat-x" and the worker ticks twice with the stub answering 503
    Then exactly 1 WARN log line reports the app id change and contains neither app id
    And the next POSTs carry "X-Commsgun-App: xstockstrat-x" and "to" = ["ops@example.com"]

  @AC-40 @FR-20
  Scenario Outline: a failed outbox insert
    Given "notify.fanout.email_provider" is "<mode>", commsgun is configured, and the outbox INSERT fails
    When the alert is emitted
    Then the outcome "enqueue_error" is recorded, 1 WARN is logged, <sg> SendGrid requests are made, and no "commsgun" alert is persisted

    Examples:
      | mode     | sg |
      | auto     | 1  |
      | commsgun | 0  |

  @AC-41 @FR-9
  Scenario: the key is re-resolved only when the config version changes
    Given commsgun is configured and the key resolved at version 7
    When 3 liveness updates arrive at version 7, then 1 update at version 8
    Then GetSecret was called exactly twice in total

  @AC-42 @FR-13
  Scenario: without the base, an unresolved key does not hold the queue
    Given "notify.fanout.email_provider" is "auto", 2 outbox rows in state "pending", "notify.commsgun.enqueue_url" is "" and GetSecret fails with UNAVAILABLE
    When the worker ticks 3 times
    Then both rows are "rerouted" with reroute_reason "lost_config" and exactly 2 SendGrid requests are made
    And exactly 1 alert with category "commsgun" is persisted
