Feature: fix-db-tls-fail-closed (bug fix)
  Regression guard for docs/reports/2026-10-21-db-tls-fail-closed-defect.md:
  Node services and the UI audit route silently disable DB TLS verification when DATABASE_CA_CERT is unset (debt-radar D-32).

  @AC-1 @FR-1 @regression
  Scenario Outline: A Node backend refuses to boot against a TLS database with no CA configured
    Given DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat?sslmode=require"
    And DATABASE_CA_CERT is unset
    When <service> starts
    Then it exits non-zero before serving gRPC
    And it logs that DATABASE_CA_CERT is required for a TLS database connection

    Examples:
      | service               |
      | xstockstrat-ledger    |
      | xstockstrat-config    |
      | xstockstrat-identity  |
      | xstockstrat-notify    |

  @AC-2 @FR-2 @regression
  Scenario Outline: A Node backend verifies the database certificate when a CA is configured
    Given DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat?sslmode=require"
    And DATABASE_CA_CERT holds a CA that did not sign the server's certificate
    When <service> starts
    Then the database connection is rejected with a certificate verification error
    And it exits non-zero and logs the certificate verification error

    Examples:
      | service               |
      | xstockstrat-ledger    |
      | xstockstrat-config    |
      | xstockstrat-identity  |
      | xstockstrat-notify    |

  @AC-3 @FR-3 @regression
  Scenario: Local compose with sslmode=disable still boots without a CA
    Given DATABASE_URL is "postgres://xstockstrat:pw@timescaledb:5432/xstockstrat?sslmode=disable"
    And DATABASE_CA_CERT is unset
    When xstockstrat-config starts
    Then it connects without TLS and serves gRPC

  @AC-4 @FR-4 @regression
  Scenario: The config-ui audit route never queries over unverified TLS
    Given the xstockstrat-ui DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat?sslmode=require"
    And DATABASE_CA_CERT is unset
    When an admin requests /config-ui/api/audit
    Then the route responds with an error status and logs that DATABASE_CA_CERT is required
    And no database query is sent

  @AC-5 @FR-5 @regression
  Scenario Outline: Every deployed component that reaches the database directly is given the CA
    Given the DigitalOcean app spec <spec>
    Then every component with DATABASE_URL among xstockstrat-ledger, xstockstrat-config, xstockstrat-identity, xstockstrat-notify and xstockstrat-ui also has DATABASE_CA_CERT bound to "${xstockstrat.CA_CERT}"

    Examples:
      | spec              |
      | .do/app.yaml      |
      | .do/app.dev.yaml  |

  @AC-6 @FR-1 @regression
  Scenario: A DATABASE_URL with no sslmode is treated as TLS and still requires a CA
    Given DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat"
    And DATABASE_CA_CERT is unset
    When xstockstrat-ledger starts
    Then it exits non-zero before serving gRPC
    And it logs that DATABASE_CA_CERT is required for a TLS database connection

  @AC-7 @FR-2 @regression
  Scenario: The config-ui audit route rejects a database certificate not signed by the configured CA
    Given the xstockstrat-ui DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat?sslmode=require"
    And DATABASE_CA_CERT holds a CA that did not sign the server's certificate
    When an admin requests /config-ui/api/audit
    Then the database connection is rejected with a certificate verification error
    And the route responds with an error status and logs the certificate verification error

  @AC-8 @FR-3 @regression
  Scenario: The config-ui audit route with sslmode=disable still reads without a CA
    Given the xstockstrat-ui DATABASE_URL is "postgres://xstockstrat:pw@timescaledb:5432/xstockstrat?sslmode=disable"
    And DATABASE_CA_CERT is unset
    When an admin requests /config-ui/api/audit
    Then the route connects without TLS and responds with status 200
