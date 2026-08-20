# Acceptance scenarios for feature 020 — notify-external-fanout.
# @AC-* IDs are append-only; each Scenario traces to a test step at /sdd-spec (Constitution C-15).
# Behavior reflects the design-approved hybrid gate (severity-primary + conviction floor when present).

Feature: External alert fanout (Slack + email) from xstockstrat-notify
  As a trader, platform alerts that clear the fanout gate are mirrored to my Slack
  workspace and/or email so I never miss a qualifying event when away from the UI,
  without ever disturbing the primary Connect-RPC alert stream.

  @AC-1 @FR-1
  Scenario: A WARNING alert is fanned out to Slack when the webhook is configured
    Given SLACK_WEBHOOK_URL is set to a non-empty incoming-webhook URL
    And notify.fanout.min_severity is 2 (WARNING)
    When the notify service emits an alert for AAPL with severity WARNING
    Then a POST is made to the Slack webhook within 5 seconds
    And the primary Connect-RPC subscriber still receives the same alert

  @AC-2 @FR-2 @FR-5
  Scenario: A qualifying alert is delivered as an email carrying every required field
    Given SENDGRID_API_KEY is set to a non-empty value
    And notify.fanout.sendgrid_from_email is "alerts@xstockstrat.io"
    And notify.fanout.sendgrid_to_email is "trader@example.com"
    When the notify service emits an alert for AAPL with severity WARNING, source_service "analysis", conviction 0.82, and created_at "2026-08-20T14:31:00Z"
    Then a POST is made to https://api.sendgrid.com/v3/mail/send within 5 seconds
    And the email body includes the symbol "AAPL", the source "analysis", the severity "WARNING", the conviction 0.82, the alert title/body, and the timestamp "2026-08-20T14:31:00Z"

  @AC-3 @FR-3 @FR-4
  Scenario: With no credentials set, nothing fans out and runtime knobs still take effect live
    Given SLACK_WEBHOOK_URL is unset
    And SENDGRID_API_KEY is unset
    When the notify service emits an alert for AAPL with severity CRITICAL
    Then no external POST is made to Slack or SendGrid
    And the primary Connect-RPC subscriber still receives the alert
    And raising notify.fanout.min_severity via the config service takes effect on the next alert with no restart

  @AC-4 @FR-6
  Scenario: A Slack webhook timeout does not delay or drop the primary stream
    Given SLACK_WEBHOOK_URL points at an endpoint that never responds
    When the notify service emits an alert for AAPL with severity WARNING
    Then the primary Connect-RPC subscriber receives the alert without added latency
    And the alert is not dropped

  @AC-5 @FR-7
  Scenario: The same alert fired twice within the dedup window fans out only once
    Given notify.fanout.dedup_window_seconds is 300
    And SLACK_WEBHOOK_URL is set to a non-empty incoming-webhook URL
    When two byte-identical WARNING alerts for AAPL are emitted 30 seconds apart
    Then exactly one POST is made to the Slack webhook

  @AC-6 @FR-6
  Scenario: A fanout channel error is logged at WARN with the alert id and channel name
    Given SLACK_WEBHOOK_URL points at an endpoint that returns HTTP 500
    When the notify service emits an alert with id "alert-abc123" and severity WARNING
    Then a WARN-level log line is written naming the alert id "alert-abc123" and the channel "slack"
    And no error propagates to the emitAlert RPC caller

  @AC-7 @FR-1
  Scenario: An alert below the severity floor is not fanned out (severity gate)
    Given notify.fanout.min_severity is 2 (WARNING)
    And SLACK_WEBHOOK_URL is set to a non-empty incoming-webhook URL
    When the notify service emits an INFO-severity fill-confirmation alert for AAPL
    Then no external POST is made

  @AC-8 @FR-1
  Scenario: A conviction-bearing alert below the conviction floor is not fanned out (conviction gate)
    Given notify.fanout.min_severity is 2 (WARNING)
    And notify.fanout.min_confidence_threshold is 0.7
    And SLACK_WEBHOOK_URL is set to a non-empty incoming-webhook URL
    When the notify service emits a WARNING alert for AAPL whose context conviction is 0.55
    Then no external POST is made

  @AC-9 @FR-1
  Scenario: A conviction-less alert is gated by severity alone (no fail-closed)
    Given notify.fanout.min_severity is 2 (WARNING)
    And notify.fanout.min_confidence_threshold is 0.7
    And SLACK_WEBHOOK_URL is set to a non-empty incoming-webhook URL
    When the notify service emits a WARNING alert for AAPL from source_service "trading" with no conviction key in its context
    Then a POST is made to the Slack webhook within 5 seconds
