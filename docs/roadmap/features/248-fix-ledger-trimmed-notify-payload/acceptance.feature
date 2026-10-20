Feature: fix-ledger-trimmed-notify-payload (bug fix)
  Regression guard for docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md:
  live StreamEvents delivers a payload-less stub for events over ~7000 chars.

  @AC-1 @regression
  Scenario: A live event whose row exceeds the NOTIFY trim threshold is delivered with its full payload
    Given a StreamEvents subscriber with no stream_key or event_type filter has caught up and is live
    And an event "order.filled" with stream_key "order-42" and a JSON payload of 8000 chars is appended
    When the subscriber receives the live message for that event
    Then the message payload equals the appended 8000-char payload
    And the message occurred_at equals the appended occurred_at and is a valid timestamp
    And the message equals GetEvent for the same event_id

  @AC-2 @regression
  Scenario: A trimmed event keeps its place in the live sequence
    Given a StreamEvents subscriber with no filters is live
    When three events are appended with payload sizes 100, 8000 and 100 chars
    Then the subscriber receives all three in ascending sequence order
    And each message carries its full payload

  @AC-3 @regression
  Scenario: A filtered live subscriber receives the full payload of a trimmed event
    Given a StreamEvents subscriber filtered on event_type "order.filled" is live
    When an "order.filled" event with a JSON payload of 8000 chars is appended
    Then the subscriber's message payload equals the appended 8000-char payload
