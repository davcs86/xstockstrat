# Durable per-service business rules for xstockstrat-identity, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-identity exports no credential plaintext or seed-admin email in OTLP logs.

  @AC-13 @FR-5 @regression @feature-274
  Scenario: Identity authentication logs export no credential plaintext
    Given xstockstrat-identity runs with OTEL_ENABLED="true"
    When an AuthenticateUser call is served with password "Hunter2!Plain" and returns an access token
    Then no exported OTLP log record body or attribute contains "Hunter2!Plain" or the issued access token string

  @AC-20 @FR-5 @regression @feature-274
  Scenario: The identity seed-admin refusal logs the user id, not the email
    Given xstockstrat-identity runs with OTEL_ENABLED="true" and a seed admin "admin@example.com" with user_id "u-seed-1"
    When a default-admin login is refused
    Then the stdout line and the exported OTLP record contain "u-seed-1"
    And neither contains "admin@example.com"
