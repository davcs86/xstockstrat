Feature: webhook-fanout-callback
  As an AI agent (or operator) that triggers a long-running backfill, I want to pass an optional
  callback_url to trigger_backfill and have xstockstrat deliver the job's terminal event to that URL
  at-least-once, so that I no longer have to poll get_backfill_status.

  Background:
    Given the notify allowlist "notify.webhook.allowed_origins" is "webhooks.ts.example.net:8443"

  @AC-1 @FR-1
  Scenario: trigger_backfill without callback_url behaves as before
    When the agent calls trigger_backfill for symbols ["AAPL"] with no callback_url
    Then a backfill job is created with status "QUEUED" and an empty callback_url
    And when the job reaches "COMPLETED" no FanoutWebhook call is made for it

  @AC-2 @FR-1 @FR-3
  Scenario: an allowed callback_url is stored on the job
    When the agent calls trigger_backfill for symbols ["AAPL"] with callback_url "https://webhooks.ts.example.net:8443/hooks/minted.backfill-x7k2"
    Then the tool returns a job_id
    And the stored job row has callback_url "https://webhooks.ts.example.net:8443/hooks/minted.backfill-x7k2" and a null webhook-enqueued-at marker

  @AC-3 @FR-2 @FR-5
  Scenario: a callback_url whose origin is not on the allowlist is rejected at trigger time
    When the agent calls trigger_backfill for symbols ["AAPL"] with callback_url "https://evil.example.org/hooks"
    Then the call fails with INVALID_ARGUMENT
    And no backfill job row is created

  @AC-4 @FR-2 @FR-5
  Scenario: with the default empty allowlist every callback_url is rejected
    Given the notify allowlist "notify.webhook.allowed_origins" is ""
    When the agent calls trigger_backfill for symbols ["AAPL"] with callback_url "https://webhooks.ts.example.net:8443/hooks"
    Then the call fails with INVALID_ARGUMENT
    And no backfill job row is created

  @AC-5 @FR-5
  Scenario Outline: FanoutWebhook rejects a URL that breaks the URL rule
    When an internal service calls FanoutWebhook with callback_url "<url>" and idempotency_key "backfill:job-1:COMPLETED"
    Then the call fails with INVALID_ARGUMENT
    And no delivery row exists for idempotency_key "backfill:job-1:COMPLETED"

    Examples:
      | url                                             |
      | http://webhooks.ts.example.net:8443/hooks       |
      | https://webhooks.ts.example.net/hooks           |
      | https://webhooks.ts.example.net:9443/hooks      |
      | https://user@webhooks.ts.example.net:8443/hooks |
      | https://evil.example.org:8443/hooks             |
      | https://webhooks.ts.example.net.evil.org:8443/h |
      | https://webhooks.ts.example.net:8443@evil.org/h |
      | ftp://webhooks.ts.example.net:8443/hooks        |
      | not-a-url                                       |

  @AC-6 @FR-6
  Scenario: FanoutWebhook persists the delivery row before acknowledging
    When an internal service calls FanoutWebhook with callback_url "https://webhooks.ts.example.net:8443/hooks", event_name "ingest.backfill.completed", payload {"job_id": "job-1", "status": "COMPLETED"} and idempotency_key "backfill:job-1:COMPLETED"
    Then the call succeeds
    And exactly 1 delivery row exists for idempotency_key "backfill:job-1:COMPLETED" in state "pending"

  @AC-7 @FR-6
  Scenario: a repeated idempotency key acknowledges without a second row
    Given a delivery row exists for idempotency_key "backfill:job-1:COMPLETED"
    When an internal service calls FanoutWebhook again with idempotency_key "backfill:job-1:COMPLETED"
    Then the call succeeds
    And exactly 1 delivery row exists for idempotency_key "backfill:job-1:COMPLETED"

  @AC-8 @FR-7 @FR-10
  Scenario: a 2xx response marks the delivery delivered and the request matches the wire format
    Given a pending delivery row for callback_url "https://webhooks.ts.example.net:8443/hooks", event_name "ingest.backfill.completed", payload {"job_id": "job-1", "status": "PARTIAL"}, idempotency_key "backfill:job-1:PARTIAL", accepted from "xstockstrat-ingest" in environment "staging"
    And the target answers 201
    When the delivery worker runs
    Then one POST is sent to "https://webhooks.ts.example.net:8443/hooks" with header "Content-Type: application/json" and header "Idempotency-Key: backfill:job-1:PARTIAL"
    And the JSON body has event_name "ingest.backfill.completed", payload.source_service "xstockstrat-ingest", payload.environment "staging", an RFC 3339 payload.occurred_at, payload.data.job_id "job-1" and payload.data.status "PARTIAL"
    And the JSON body contains no "user_id" key at any depth
    And the row is in state "delivered"

  @AC-9 @FR-7
  Scenario Outline: retryable failures leave the row pending with a later next attempt
    Given a pending delivery row with 0 attempts
    And the target <outcome>
    When the delivery worker runs
    Then the row is in state "pending" with 1 attempt and a next-attempt time in the future

    Examples:
      | outcome             |
      | answers 408         |
      | answers 429         |
      | answers 500         |
      | answers 503         |
      | refuses connections |
      | times out           |

  @AC-10 @FR-7 @FR-8
  Scenario Outline: a non-retryable response marks the row dead at once and raises a WARNING alert
    Given a pending delivery row with 0 attempts for event_name "ingest.backfill.completed"
    And the target answers <status>
    When the delivery worker runs
    Then the row is in state "dead" with 1 attempt
    And one alert with severity "WARNING" is emitted that names "ingest.backfill.completed" and the origin "webhooks.ts.example.net:8443"

    Examples:
      | status |
      | 400    |
      | 404    |
      | 413    |
      | 422    |

  @AC-11 @FR-7 @FR-8
  Scenario: retries are exhausted after the configured number of attempts
    Given "notify.webhook.max_attempts" is 3
    And a pending delivery row with 2 attempts
    And the target answers 503
    When the delivery worker runs
    Then the row is in state "dead" with 3 attempts
    And one alert with severity "WARNING" is emitted for that row

  @AC-12 @FR-7
  Scenario: the delay between attempts grows exponentially up to the cap
    Given "notify.webhook.backoff_base_seconds" is 30 and "notify.webhook.backoff_max_seconds" is 120
    When a row fails its 1st, 2nd, 3rd and 4th attempt with 503
    Then the delays scheduled before the next attempt are 30, 60, 120 and 120 seconds

  @AC-13 @FR-7
  Scenario: a failing target does not delay another target's delivery
    Given a pending row A for "https://webhooks.ts.example.net:8443/hooks/a" whose target times out
    And a pending row B for "https://webhooks.ts.example.net:8443/hooks/b" whose target answers 201
    When the delivery worker runs once
    Then row B is in state "delivered"
    And row A is in state "pending" with 1 attempt

  @AC-14 @FR-9
  Scenario: pending rows survive a notify restart
    Given the delivery table already holds a row in state "pending" that no worker has in flight
    When a new delivery worker starts and the target answers 201
    Then the row is in state "delivered" without a new FanoutWebhook call

  @AC-15 @FR-5
  Scenario: the URL rule is enforced again at delivery time
    Given a pending delivery row for "https://webhooks.ts.example.net:8443/hooks"
    And the notify allowlist "notify.webhook.allowed_origins" is changed to ""
    When the delivery worker runs
    Then no HTTP request is sent
    And the row is in state "dead"
    And one alert with severity "WARNING" is emitted for that row

  @AC-16 @FR-5 @FR-7
  Scenario: a redirect is not followed
    Given a pending delivery row for "https://webhooks.ts.example.net:8443/hooks"
    And the target answers 302 with Location "https://evil.example.org/hooks"
    When the delivery worker runs
    Then no request is sent to "evil.example.org"
    And the row is in state "dead"

  @AC-17 @FR-3
  Scenario Outline: a terminal job with a callback_url is handed to notify with a stable key
    Given a backfill job "job-1" with callback_url "https://webhooks.ts.example.net:8443/hooks"
    When the job reaches terminal status "<status>"
    Then ingest calls FanoutWebhook with event_name "<event_name>", idempotency_key "backfill:job-1:<status>" and a payload whose job_id is "job-1" and whose status is "<status>"
    And the call is made by the hand-off loop, woken by the terminal write, not on the backfill path
    And the job's webhook-enqueued-at marker is set after notify acknowledges

    Examples:
      | status    | event_name                |
      | COMPLETED | ingest.backfill.completed |
      | PARTIAL   | ingest.backfill.completed |
      | FAILED    | ingest.backfill.failed    |
      | CANCELED  | ingest.backfill.canceled  |

  @AC-18 @FR-4
  Scenario: notify being down delays the webhook and does not change the job outcome
    Given a backfill job "job-2" with callback_url "https://webhooks.ts.example.net:8443/hooks"
    And FanoutWebhook fails with UNAVAILABLE
    When the job reaches terminal status "COMPLETED"
    Then the job's status is "COMPLETED" and its existing ledger event is emitted as before
    And the job's webhook-enqueued-at marker is null

  @AC-19 @FR-4
  Scenario: the sweep retries the hand-off until notify acknowledges
    Given a terminal job "job-2" with status "COMPLETED", a callback_url and a null webhook-enqueued-at marker
    And FanoutWebhook now succeeds
    When the hand-off sweep runs
    Then ingest calls FanoutWebhook with idempotency_key "backfill:job-2:COMPLETED"
    And the job's webhook-enqueued-at marker is set
    And a second sweep run makes no FanoutWebhook call for "job-2"

  @AC-20 @FR-4
  Scenario: a hand-off notify rejects as INVALID_ARGUMENT is not retried forever
    Given a terminal job "job-3" with a callback_url and a null webhook-enqueued-at marker
    And FanoutWebhook fails with INVALID_ARGUMENT
    When the hand-off sweep runs twice
    Then ingest calls FanoutWebhook for "job-3" exactly once
    And the job's webhook-rejected-at marker is set and its webhook-enqueued-at marker is null
    And one alert with severity "WARNING" is emitted that names "job-3"

  @AC-21 @FR-4
  Scenario: the sweep ignores jobs without a callback_url and non-terminal jobs
    Given a terminal job "job-4" with no callback_url
    And a "RUNNING" job "job-5" with callback_url "https://webhooks.ts.example.net:8443/hooks"
    When the hand-off sweep runs
    Then no FanoutWebhook call is made for "job-4" or "job-5"

  @AC-22 @FR-11
  Scenario: the tool documentation and the strat-lab skill describe callback_url
    When a reader opens "docs/runbooks/mcp-tools.md" and the strat-lab "backtest" skill
    Then both name the "callback_url" argument of trigger_backfill and state that the URL must be https and allowlisted

  @AC-23 @FR-5
  Scenario: scheme and host are matched case-insensitively against the allowlist
    When an internal service calls FanoutWebhook with callback_url "HTTPS://WEBHOOKS.TS.EXAMPLE.NET:8443/hooks" and idempotency_key "backfill:job-9:COMPLETED"
    Then the call succeeds
    And exactly 1 delivery row exists for idempotency_key "backfill:job-9:COMPLETED"

  @AC-24 @FR-6
  Scenario: nothing is acknowledged when the delivery row cannot be persisted
    Given the notify database rejects the insert
    When an internal service calls FanoutWebhook with callback_url "https://webhooks.ts.example.net:8443/hooks" and idempotency_key "backfill:job-8:COMPLETED"
    Then the call fails with a non-OK status
    And no delivery row exists for idempotency_key "backfill:job-8:COMPLETED"

  @AC-25 @FR-3
  Scenario: a job failed by restart reconciliation is handed off
    Given a "RUNNING" job "job-6" with callback_url "https://webhooks.ts.example.net:8443/hooks"
    And ingest restarts and reconciles "job-6" to "FAILED" with no chunk left to resume
    When the hand-off sweep runs
    Then ingest calls FanoutWebhook with event_name "ingest.backfill.failed" and idempotency_key "backfill:job-6:FAILED"

  @AC-26 @FR-2
  Scenario: trigger_backfill with a callback_url fails closed when notify cannot validate it
    Given FanoutWebhook fails with UNAVAILABLE
    When the agent calls trigger_backfill for symbols ["AAPL"] with callback_url "https://webhooks.ts.example.net:8443/hooks"
    Then the call fails with UNAVAILABLE and a message stating that no job was created
    And no backfill job row is created

  @AC-27 @FR-6
  Scenario: FanoutWebhook refuses a caller that is not an allow-listed internal service
    When a peer whose certificate SAN is "xstockstrat-agent" calls FanoutWebhook with callback_url "https://webhooks.ts.example.net:8443/hooks" and idempotency_key "backfill:job-7:COMPLETED"
    Then the call fails with PERMISSION_DENIED
    And no delivery row exists for idempotency_key "backfill:job-7:COMPLETED"

  @AC-28 @FR-2
  Scenario: a validate-only call checks the URL and stores nothing
    When "xstockstrat-ingest" calls FanoutWebhook with callback_url "https://webhooks.ts.example.net:8443/hooks", validate_only true and no event_name or idempotency_key
    Then the call succeeds
    And the delivery table holds 0 rows

  @AC-29 @FR-3
  Scenario: a job is handed off once even if it later reaches another terminal status
    Given a job "job-10" with status "PARTIAL", a callback_url and a set webhook-enqueued-at marker
    And a later restart re-drives "job-10" to status "FAILED"
    When the hand-off sweep runs
    Then no FanoutWebhook call is made for "job-10"

  @AC-30 @FR-3 @FR-10
  Scenario: the published data comes from the stored job and carries no error text
    Given a "FAILED" job "job-11" for symbols ["AAPL", "MSFT"] with data_kind "BARS", bars_processed 0, failed_symbols ["AAPL", "MSFT"], error "internal: peer ipv4:10.0.0.7:50053" and a callback_url
    When the hand-off sweep runs
    Then the FanoutWebhook payload has exactly the keys job_id, status, data_kind, symbols, bars_processed, failed_symbols, started_at and completed_at
    And the payload contains no "error" key
