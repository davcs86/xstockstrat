# Promoted from docs/roadmap/features/266-fix-db-tls-fail-closed/acceptance.feature
# Source feature 266 (fix-db-tls-fail-closed). config-ui audit route DB TLS behavior.
Feature: fix-db-tls-fail-closed (ui)
  Acceptance scenarios for the xstockstrat-ui audit route promoted from feature 266.

  @AC-4 @FR-4 @feature-266
  Scenario: The config-ui audit route never queries over unverified TLS
    Given the xstockstrat-ui DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat?sslmode=require"
    And DATABASE_CA_CERT is unset
    When an admin requests /config-ui/api/audit
    Then the route responds with an error status and logs that DATABASE_CA_CERT is required
    And no database query is sent

  @AC-7 @FR-2 @feature-266
  Scenario: The config-ui audit route rejects a database certificate not signed by the configured CA
    Given the xstockstrat-ui DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat?sslmode=require"
    And DATABASE_CA_CERT holds a CA that did not sign the server's certificate
    When an admin requests /config-ui/api/audit
    Then the database connection is rejected with a certificate verification error
    And the route responds with an error status and logs the certificate verification error

  @AC-8 @FR-3 @feature-266
  Scenario: The config-ui audit route with sslmode=disable still reads without a CA
    Given the xstockstrat-ui DATABASE_URL is "postgres://xstockstrat:pw@timescaledb:5432/xstockstrat?sslmode=disable"
    And DATABASE_CA_CERT is unset
    When an admin requests /config-ui/api/audit
    Then the route connects without TLS and responds with status 200
