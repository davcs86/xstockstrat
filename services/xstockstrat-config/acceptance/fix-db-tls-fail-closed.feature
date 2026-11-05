# Promoted from docs/roadmap/features/266-fix-db-tls-fail-closed/acceptance.feature
# Source feature 266 (fix-db-tls-fail-closed). Config service DB TLS behavior.
Feature: fix-db-tls-fail-closed (config)
  Acceptance scenarios for the xstockstrat-config service promoted from feature 266.

  @AC-3 @FR-3 @feature-266
  Scenario: Local compose with sslmode=disable still boots without a CA
    Given DATABASE_URL is "postgres://xstockstrat:pw@timescaledb:5432/xstockstrat?sslmode=disable"
    And DATABASE_CA_CERT is unset
    When xstockstrat-config starts
    Then it connects without TLS and serves gRPC
