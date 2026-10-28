Feature: fix-ledger-trimmed-notify-payload (bug fix)
  Regression guard for docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md:
  live StreamEvents delivers a payload-less stub for events over ~7000 chars.

  @AC-1 @FR-1 @regression
  Scenario: A live event whose row exceeds the NOTIFY trim threshold is delivered with its full payload
    Given a StreamEvents subscriber with no stream_key or event_type filter has caught up and is live
    And an event "order.filled" with stream_key "order-42" and a JSON payload of 8000 chars is appended
    And that event has source_service "xstockstrat-trading", correlation_id "corr-42", metadata {"broker": "alpaca"} and user_id "user-7"
    When the subscriber receives the live message for that event
    Then the message payload equals the appended 8000-char payload
    And the message occurred_at equals the appended occurred_at and is a valid timestamp
    And the message has source_service "xstockstrat-trading", correlation_id "corr-42", metadata {"broker": "alpaca"} and user_id "user-7"
    And the message equals GetEvent for the same event_id

  @AC-2 @FR-3 @regression
  Scenario: A trimmed event keeps its place in the live sequence
    Given a StreamEvents subscriber with no filters is live
    When three events are appended back-to-back, without waiting for delivery, with payload sizes 100, 8000 and 100 chars
    Then the subscriber receives exactly three messages, in ascending sequence order, with no duplicate sequence
    And each message carries its full payload

  @AC-3 @FR-1 @regression
  Scenario: A filtered live subscriber receives the full payload of a trimmed event
    Given a StreamEvents subscriber filtered on event_type "order.filled" is live
    When an "order.filled" event with a JSON payload of 8000 chars is appended
    Then the subscriber's message payload equals the appended 8000-char payload

  @AC-4 @FR-2 @regression
  Scenario: Resolving a trimmed live event does not hold the single query-pool connection
    Given the ledger query pool max is 1 (DB_POOL_MAX=1)
    And a StreamEvents subscriber with no filters is live and has stopped reading its stream
    When an "order.filled" event with a JSON payload of 8000 chars is appended
    And a second "order.filled" event with a 100-char payload is appended
    Then the second AppendEvent returns its event_id before the subscriber resumes reading
    And after the subscriber resumes it receives both events with their full payloads in ascending sequence order

  @AC-5 @FR-1 @FR-3 @regression
  Scenario: A trimmed event appended during replay is flushed from the buffer with its full payload
    Given the ledger holds 50 events with 100-char payloads
    And a StreamEvents subscriber with no filters opens from sequence 0
    When an "order.filled" event with a JSON payload of 8000 chars is appended after the subscriber's replay query has read its rows and before the subscriber goes live
    Then the subscriber receives that event exactly once, with the appended 8000-char payload and a valid occurred_at
    And the subscriber receives 51 messages in ascending sequence order with no duplicate sequence

  @AC-6 @FR-4 @regression
  Scenario: A trimmed live event whose full row cannot be read is never delivered as a stub
    Given a StreamEvents subscriber with no filters is live and its last delivered sequence is 10
    And the live stream's read of the full row for the next trimmed event fails with a database error until that error clears
    When an "order.filled" event with a JSON payload of 8000 chars is appended as sequence 11
    And an event with a 100-char payload is appended as sequence 12
    Then the subscriber receives no message for sequence 11 or 12 on that stream
    And the stream ends with a non-OK gRPC status
    And once the database error clears, a new StreamEvents opened from sequence 11 receives sequences 11 and 12 with their full payloads, in that order

  @AC-7 @FR-4 @regression
  Scenario: A trimmed live event whose full row is not found is never delivered as a stub
    Given a StreamEvents subscriber with no filters is live and its last delivered sequence is 10
    And the live stream's read of the full row by event_id for the next trimmed event returns no row
    When an "order.filled" event with a JSON payload of 8000 chars is appended as sequence 11
    And an event with a 100-char payload is appended as sequence 12
    Then the subscriber receives no message for sequence 11 or 12 on that stream
    And the stream ends with a non-OK gRPC status
    And a new StreamEvents opened from sequence 11 receives sequences 11 and 12 with their full payloads, in that order

  @AC-8 @FR-1 @regression
  Scenario: A stream_key-filtered live subscriber receives the full payload of a trimmed event
    Given a StreamEvents subscriber filtered on stream_key "order-42" is live
    When an "order.filled" event with stream_key "order-42" and a JSON payload of 8000 chars is appended
    Then the subscriber's message payload equals the appended 8000-char payload
    And the message occurred_at equals the appended occurred_at and is a valid timestamp

  @AC-9 @FR-2 @FR-4 @regression
  Scenario: A trimmed event whose full-row read exceeds the resolve bound ends only matching streams non-OK
    Given ledger.stream.resolve_timeout_ms is 200
    And a StreamEvents subscriber with no filters is live and its last delivered sequence is 10
    And a StreamEvents subscriber filtered on event_type "account.balance.synced" is live
    And the full-row read for the next trimmed event takes longer than 200 ms
    When an "order.filled" event with a JSON payload of 8000 chars is appended as sequence 11
    And an event with a 100-char payload is appended as sequence 12
    Then the unfiltered subscriber receives no message for sequence 11 or 12 on that stream
    And that stream ends with a non-OK gRPC status within 400 ms
    And the "account.balance.synced" subscriber's stream is not ended
    And a new StreamEvents opened from sequence 11 receives sequences 11 and 12 with their full payloads, in that order
