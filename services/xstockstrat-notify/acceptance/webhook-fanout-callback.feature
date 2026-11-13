# Promoted from docs/roadmap/features/334-webhook-fanout-callback/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-334` tag.
# Durable business rules xstockstrat-notify guarantees for the FanoutWebhook at-least-once delivery path.
# A rule enters only by promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-notify - FanoutWebhook delivers a callback at-least-once to an allowlisted https origin
    As an AI agent (or operator) that triggers a long-running backfill, I want to pass an optional
    callback_url to trigger_backfill and have xstockstrat deliver the job's terminal event to that URL
    at-least-once, so that I no longer have to poll get_backfill_status.

  Background:
    Given the notify allowlist "notify.webhook.allowed_origins" is "webhooks.ts.example.net:8443"

  @AC-5 @FR-5 @feature-334
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

  @AC-6 @FR-6 @feature-334
  Scenario: FanoutWebhook persists the delivery row before acknowledging
    When an internal service calls FanoutWebhook with callback_url "https://webhooks.ts.example.net:8443/hooks", event_name "ingest.backfill.completed", payload {"job_id": "job-1", "status": "COMPLETED"} and idempotency_key "backfill:job-1:COMPLETED"
    Then the call succeeds
    And exactly 1 delivery row exists for idempotency_key "backfill:job-1:COMPLETED" in state "pending"

  @AC-7 @FR-6 @feature-334
  Scenario: a repeated idempotency key acknowledges without a second row
    Given a delivery row exists for idempotency_key "backfill:job-1:COMPLETED"
    When an internal service calls FanoutWebhook again with idempotency_key "backfill:job-1:COMPLETED"
    Then the call succeeds
    And exactly 1 delivery row exists for idempotency_key "backfill:job-1:COMPLETED"

  @AC-8 @FR-7 @FR-10 @feature-334
  Scenario: a 2xx response marks the delivery delivered and the request matches the wire format
    Given a pending delivery row for callback_url "https://webhooks.ts.example.net:8443/hooks", event_name "ingest.backfill.completed", payload {"job_id": "job-1", "status": "PARTIAL"}, idempotency_key "backfill:job-1:PARTIAL", accepted from "xstockstrat-ingest" in environment "staging"
    And the target answers 201
    When the delivery worker runs
    Then one POST is sent to "https://webhooks.ts.example.net:8443/hooks" with header "Content-Type: application/json" and header "Idempotency-Key: backfill:job-1:PARTIAL"
    And the JSON body has event_name "ingest.backfill.completed", payload.source_service "xstockstrat-ingest", payload.environment "staging", an RFC 3339 payload.occurred_at, payload.data.job_id "job-1" and payload.data.status "PARTIAL"
    And the JSON body contains no "user_id" key at any depth
    And the row is in state "delivered"

  @AC-9 @FR-7 @feature-334
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

  @AC-10 @FR-7 @FR-8 @feature-334
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

  @AC-11 @FR-7 @FR-8 @feature-334
  Scenario: retries are exhausted after the configured number of attempts
    Given "notify.webhook.max_attempts" is 3
    And a pending delivery row with 2 attempts
    And the target answers 503
    When the delivery worker runs
    Then the row is in state "dead" with 3 attempts
    And one alert with severity "WARNING" is emitted for that row

  @AC-12 @FR-7 @feature-334
  Scenario: the delay between attempts grows exponentially up to the cap
    Given "notify.webhook.backoff_base_seconds" is 30 and "notify.webhook.backoff_max_seconds" is 120
    When a row fails its 1st, 2nd, 3rd and 4th attempt with 503
    Then the delays scheduled before the next attempt are 30, 60, 120 and 120 seconds

  @AC-13 @FR-7 @feature-334
  Scenario: a failing target does not delay another target's delivery
    Given a pending row A for "https://webhooks.ts.example.net:8443/hooks/a" whose target times out
    And a pending row B for "https://webhooks.ts.example.net:8443/hooks/b" whose target answers 201
    When the delivery worker runs once
    Then row B is in state "delivered"
    And row A is in state "pending" with 1 attempt

  @AC-14 @FR-9 @feature-334
  Scenario: pending rows survive a notify restart
    Given the delivery table already holds a row in state "pending" that no worker has in flight
    When a new delivery worker starts and the target answers 201
    Then the row is in state "delivered" without a new FanoutWebhook call

  @AC-15 @FR-5 @feature-334
  Scenario: the URL rule is enforced again at delivery time
    Given a pending delivery row for "https://webhooks.ts.example.net:8443/hooks"
    And the notify allowlist "notify.webhook.allowed_origins" is changed to ""
    When the delivery worker runs
    Then no HTTP request is sent
    And the row is in state "dead"
    And one alert with severity "WARNING" is emitted for that row

  @AC-16 @FR-5 @FR-7 @feature-334
  Scenario: a redirect is not followed
    Given a pending delivery row for "https://webhooks.ts.example.net:8443/hooks"
    And the target answers 302 with Location "https://evil.example.org/hooks"
    When the delivery worker runs
    Then no request is sent to "evil.example.org"
    And the row is in state "dead"

  @AC-23 @FR-5 @feature-334
  Scenario: scheme and host are matched case-insensitively against the allowlist
    When an internal service calls FanoutWebhook with callback_url "HTTPS://WEBHOOKS.TS.EXAMPLE.NET:8443/hooks" and idempotency_key "backfill:job-9:COMPLETED"
    Then the call succeeds
    And exactly 1 delivery row exists for idempotency_key "backfill:job-9:COMPLETED"

  @AC-24 @FR-6 @feature-334
  Scenario: nothing is acknowledged when the delivery row cannot be persisted
    Given the notify database rejects the insert
    When an internal service calls FanoutWebhook with callback_url "https://webhooks.ts.example.net:8443/hooks" and idempotency_key "backfill:job-8:COMPLETED"
    Then the call fails with a non-OK status
    And no delivery row exists for idempotency_key "backfill:job-8:COMPLETED"

  @AC-27 @FR-6 @feature-334
  Scenario: FanoutWebhook refuses a caller that is not an allow-listed internal service
    When a peer whose certificate SAN is "xstockstrat-agent" calls FanoutWebhook with callback_url "https://webhooks.ts.example.net:8443/hooks" and idempotency_key "backfill:job-7:COMPLETED"
    Then the call fails with PERMISSION_DENIED
    And no delivery row exists for idempotency_key "backfill:job-7:COMPLETED"

  @AC-28 @FR-2 @feature-334
  Scenario: a validate-only call checks the URL and stores nothing
    When "xstockstrat-ingest" calls FanoutWebhook with callback_url "https://webhooks.ts.example.net:8443/hooks", validate_only true and no event_name or idempotency_key
    Then the call succeeds
    And the delivery table holds 0 rows
