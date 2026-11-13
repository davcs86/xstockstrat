# Promoted from docs/roadmap/features/334-webhook-fanout-callback/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-334` tag.
# Durable business rules xstockstrat-ingest guarantees for the backfill callback_url and its hand-off to notify.
# A rule enters only by promotion from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-ingest - a backfill job's terminal event is handed to notify once, without changing the job outcome
    As an AI agent (or operator) that triggers a long-running backfill, I want to pass an optional
    callback_url to trigger_backfill and have xstockstrat deliver the job's terminal event to that URL
    at-least-once, so that I no longer have to poll get_backfill_status.

  Background:
    Given the notify allowlist "notify.webhook.allowed_origins" is "webhooks.ts.example.net:8443"

  @AC-1 @FR-1 @feature-334
  Scenario: trigger_backfill without callback_url behaves as before
    When the agent calls trigger_backfill for symbols ["AAPL"] with no callback_url
    Then a backfill job is created with status "QUEUED" and an empty callback_url
    And when the job reaches "COMPLETED" no FanoutWebhook call is made for it

  @AC-2 @FR-1 @FR-3 @feature-334
  Scenario: an allowed callback_url is stored on the job
    When the agent calls trigger_backfill for symbols ["AAPL"] with callback_url "https://webhooks.ts.example.net:8443/hooks/minted.backfill-x7k2"
    Then the tool returns a job_id
    And the stored job row has callback_url "https://webhooks.ts.example.net:8443/hooks/minted.backfill-x7k2" and a null webhook-enqueued-at marker

  @AC-3 @FR-2 @FR-5 @feature-334
  Scenario: a callback_url whose origin is not on the allowlist is rejected at trigger time
    When the agent calls trigger_backfill for symbols ["AAPL"] with callback_url "https://evil.example.org/hooks"
    Then the call fails with INVALID_ARGUMENT
    And no backfill job row is created

  @AC-4 @FR-2 @FR-5 @feature-334
  Scenario: with the default empty allowlist every callback_url is rejected
    Given the notify allowlist "notify.webhook.allowed_origins" is ""
    When the agent calls trigger_backfill for symbols ["AAPL"] with callback_url "https://webhooks.ts.example.net:8443/hooks"
    Then the call fails with INVALID_ARGUMENT
    And no backfill job row is created

  @AC-17 @FR-3 @feature-334
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

  @AC-18 @FR-4 @feature-334
  Scenario: notify being down delays the webhook and does not change the job outcome
    Given a backfill job "job-2" with callback_url "https://webhooks.ts.example.net:8443/hooks"
    And FanoutWebhook fails with UNAVAILABLE
    When the job reaches terminal status "COMPLETED"
    Then the job's status is "COMPLETED" and its existing ledger event is emitted as before
    And the job's webhook-enqueued-at marker is null

  @AC-19 @FR-4 @feature-334
  Scenario: the sweep retries the hand-off until notify acknowledges
    Given a terminal job "job-2" with status "COMPLETED", a callback_url and a null webhook-enqueued-at marker
    And FanoutWebhook now succeeds
    When the hand-off sweep runs
    Then ingest calls FanoutWebhook with idempotency_key "backfill:job-2:COMPLETED"
    And the job's webhook-enqueued-at marker is set
    And a second sweep run makes no FanoutWebhook call for "job-2"

  @AC-20 @FR-4 @feature-334
  Scenario: a hand-off notify rejects as INVALID_ARGUMENT is not retried forever
    Given a terminal job "job-3" with a callback_url and a null webhook-enqueued-at marker
    And FanoutWebhook fails with INVALID_ARGUMENT
    When the hand-off sweep runs twice
    Then ingest calls FanoutWebhook for "job-3" exactly once
    And the job's webhook-rejected-at marker is set and its webhook-enqueued-at marker is null
    And one alert with severity "WARNING" is emitted that names "job-3"

  @AC-21 @FR-4 @feature-334
  Scenario: the sweep ignores jobs without a callback_url and non-terminal jobs
    Given a terminal job "job-4" with no callback_url
    And a "RUNNING" job "job-5" with callback_url "https://webhooks.ts.example.net:8443/hooks"
    When the hand-off sweep runs
    Then no FanoutWebhook call is made for "job-4" or "job-5"

  @AC-25 @FR-3 @feature-334
  Scenario: a job failed by restart reconciliation is handed off
    Given a "RUNNING" job "job-6" with callback_url "https://webhooks.ts.example.net:8443/hooks"
    And ingest restarts and reconciles "job-6" to "FAILED" with no chunk left to resume
    When the hand-off sweep runs
    Then ingest calls FanoutWebhook with event_name "ingest.backfill.failed" and idempotency_key "backfill:job-6:FAILED"

  @AC-26 @FR-2 @feature-334
  Scenario: trigger_backfill with a callback_url fails closed when notify cannot validate it
    Given FanoutWebhook fails with UNAVAILABLE
    When the agent calls trigger_backfill for symbols ["AAPL"] with callback_url "https://webhooks.ts.example.net:8443/hooks"
    Then the call fails with UNAVAILABLE and a message stating that no job was created
    And no backfill job row is created

  @AC-29 @FR-3 @feature-334
  Scenario: a job is handed off once even if it later reaches another terminal status
    Given a job "job-10" with status "PARTIAL", a callback_url and a set webhook-enqueued-at marker
    And a later restart re-drives "job-10" to status "FAILED"
    When the hand-off sweep runs
    Then no FanoutWebhook call is made for "job-10"

  @AC-30 @FR-3 @FR-10 @feature-334
  Scenario: the published data comes from the stored job and carries no error text
    Given a "FAILED" job "job-11" for symbols ["AAPL", "MSFT"] with data_kind "BARS", bars_processed 0, failed_symbols ["AAPL", "MSFT"], error "internal: peer ipv4:10.0.0.7:50053" and a callback_url
    When the hand-off sweep runs
    Then the FanoutWebhook payload has exactly the keys job_id, status, data_kind, symbols, bars_processed, failed_symbols, started_at and completed_at
    And the payload contains no "error" key
