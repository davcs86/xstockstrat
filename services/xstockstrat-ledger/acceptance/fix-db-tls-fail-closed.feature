# Promoted from docs/roadmap/features/266-fix-db-tls-fail-closed/acceptance.feature
# Source feature 266 (fix-db-tls-fail-closed). Ledger DB TLS behavior.
Feature: fix-db-tls-fail-closed (ledger)
  Acceptance scenarios for the xstockstrat-ledger service promoted from feature 266.

  @AC-6 @FR-1 @feature-266
  Scenario: A DATABASE_URL with no sslmode is treated as TLS and still requires a CA
    Given DATABASE_URL is "postgres://u:p@db.example:25060/xstockstrat"
    And DATABASE_CA_CERT is unset
    When xstockstrat-ledger starts
    Then it exits non-zero before serving gRPC
    And it logs that DATABASE_CA_CERT is required for a TLS database connection
