# Promoted from docs/roadmap/features/294-signal-map-instrumentation/acceptance.feature (C-16). Verbatim; do not edit by hand.
Feature: signal-map-instrumentation (identity)

  @AC-22 @FR-7 @feature-294
  Scenario: Identity separates login failure reasons without logging the account
    Given a login for "a@example.com" with a wrong password and a login for an unknown email
    When both AuthenticateUser calls fail
    Then "identity.login.failures" with reason "bad_password" increases by 1
    And "identity.login.failures" with reason "unknown_or_inactive" increases by 1
    And both responses are still code 16 "invalid credentials"
    And no log line or label contains "a@example.com"

  @AC-23 @FR-7 @feature-294
  Scenario: Token validation failures are classified and a missing secret logs once at ERROR
    Given ValidateToken receives an expired token, then a malformed token, then runs with JWT_SECRET unset
    When each call fails
    Then "identity.token.validate_failures" increases by 1 each for reasons "expired", "invalid" and "secret_missing"
    And exactly 1 ERROR log "ValidateToken: JWT secret missing" is written, for "secret_missing"
    And no per-call log is written for the expired and invalid cases
    And every response is still code 16 "invalid or expired token"

  @AC-24 @FR-7 @feature-294
  Scenario: A failed audit append is counted and timed without adding a deadline
    Given the ledger AppendEvent fails for event type "identity.user.created"
    When the audit is appended
    Then "identity.audit.failures" with event_type "identity.user.created" increases by 1
    And "identity.audit.append.duration" records 1 sample
    And the AppendEvent call still has no deadline

  @AC-52 @FR-7 @feature-294
  Scenario: Identity counts code-exchange and refresh rejections by bounded reason
    Given an authorization code already redeemed once and a refresh token that is expired
    When ExchangeAuthCode and RefreshToken are called
    Then "identity.oauth.exchange_failures" with reason "replay" increases by 1
    And "identity.refresh.rejections" with kind "first_party" increases by 1
    And both responses are unchanged
