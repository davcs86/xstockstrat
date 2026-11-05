Feature: agent-log-query
  As an operator holding the log_reader role, I want Claude.ai to read the recent logs of the
  xstockstrat app services and the database host for the agent's environment, so I can diagnose
  staging and production issues from a Claude conversation.

  @AC-1 @FR-1
  Scenario: App-service container logs reach Loki with the required labels
    Given the collector runs on the staging app host
    And container "xstockstrat-trading" writes the stdout line "order submitted id=ord-123"
    When 60 seconds have passed
    Then Loki returns that line for the selector {environment="staging", service="xstockstrat-trading"}
    And the stream carries a non-empty "host" label

  @AC-2 @FR-1
  Scenario: Database-host logs reach Loki
    Given the collector runs on the database host serving "production"
    And Postgres logs "checkpoint complete"
    When 60 seconds have passed
    Then Loki returns that line for the selector {environment="production", service="postgres"}

  @AC-3 @FR-2
  Scenario: Credentials are redacted before leaving the host
    Given container "xstockstrat-agent" writes "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def"
    And container "xstockstrat-config" writes "postgres://app:s3cretPW@db:25060/x"
    When the lines are stored in Loki
    Then the stored lines contain neither "eyJhbGciOiJIUzI1NiJ9.abc.def" nor "s3cretPW"
    And each stored line contains the marker "[redacted]"

  @AC-4 @FR-3 @FR-5
  Scenario: A log_reader reads filtered logs
    Given a caller whose verified roles are ["log_reader"]
    And Loki holds 3 "error" lines for service "xstockstrat-trading" in the last 15 minutes
    When the caller invokes query_logs with service "xstockstrat-trading", level "error", since "15m"
    Then the response contains exactly those 3 lines, each with timestamp, service and host
    And the response has "truncated": false

  @AC-5 @FR-3
  Scenario: Unknown service names and LogQL syntax are rejected
    When a log_reader invokes query_logs with service "xstockstrat-trading\"} |= \"\" or {job=~\".+"
    Then the call fails with a validation error naming the allowed services
    And no request is sent to Loki

  @AC-6 @FR-3
  Scenario: The contains filter is matched literally
    Given Loki holds the line "fill qty=10 (partial)" for service "xstockstrat-trading"
    When a log_reader invokes query_logs with service "xstockstrat-trading" and contains "qty=10 (partial)"
    Then the response contains that line

  @AC-7 @FR-4
  Scenario: A staging agent never returns production lines
    Given the agent runs with APPLICATION_ENV "staging"
    And Loki holds lines for service "xstockstrat-ui" in both "staging" and "production"
    When a log_reader invokes query_logs with service "xstockstrat-ui"
    Then every returned line has environment "staging"

  @AC-8 @FR-5
  Scenario: Admin without log_reader is denied
    Given a caller whose verified roles are ["admin"]
    When the caller invokes query_logs with service "xstockstrat-trading"
    Then the call fails with "permission denied: log_reader role required"
    And no request is sent to Loki

  @AC-9 @FR-5
  Scenario: The log_reader role survives token minting
    Given an admin sets the roles of user "ops@example.com" to ["trader", "log_reader"]
    When that user completes the Claude.ai OAuth login
    Then the validated token claims list roles ["trader", "log_reader"]
    And the derived x-access-scope has bit 0x10 set

  @AC-10 @FR-6
  Scenario: Output is capped and truncation is reported
    Given agent.logs.max_lines is 500
    And Loki holds 2000 matching lines in the requested window
    When a log_reader invokes query_logs for that window
    Then the response contains 500 lines
    And the response has "truncated": true and "truncated_by": "max_lines"

  @AC-11 @FR-6
  Scenario: A time window beyond the cap is rejected
    Given agent.logs.max_range_hours is 24
    When a log_reader invokes query_logs with since "2026-10-01T00:00:00Z" and until "2026-10-03T00:00:00Z"
    Then the call fails with a validation error stating the 24-hour maximum

  @AC-12 @FR-7
  Scenario: The Loki token never appears in tool surfaces
    Given agent.logs.loki_token is a secret row with value "glc_TESTTOKEN123"
    When GET /api/tools is requested and query_logs fails with Loki returning HTTP 401
    Then neither the catalog nor the error message contains "glc_TESTTOKEN123"

  @AC-13 @FR-8
  Scenario: Every call is audited without log content
    When a log_reader with user_id "u-42" invokes query_logs with service "postgres" and receives 7 lines
    Then the ledger holds one event with user_id "u-42", environment, service "postgres", line_count 7, outcome "ok"
    And the event contains none of the 7 returned lines

  @AC-14 @FR-8
  Scenario: Denied calls are audited
    When a caller without log_reader invokes query_logs
    Then the ledger holds one event for that caller with outcome "denied"

  @AC-15 @FR-9
  Scenario: Loki outage is isolated to query_logs
    Given agent.logs.timeout_ms is 10000
    And Loki does not respond
    When a log_reader invokes query_logs
    Then the call fails within 11 seconds with "log store unavailable"
    And a concurrent get_positions call succeeds
