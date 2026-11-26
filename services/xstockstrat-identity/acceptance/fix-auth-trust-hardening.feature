# Promoted from docs/roadmap/features/319-fix-auth-trust-hardening/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-319` tag.
# Durable business rules xstockstrat-identity already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-identity - RevokeToken acts only on a genuinely signed token
  Token revocation verifies the JWT signature; an unsigned token revokes nothing.

  # guards: docs/reports/2026-10-19-identity-revoketoken-unverified-decode-defect.md
  @AC-2 @regression @feature-319
  Scenario: RevokeToken with an unsigned token revokes nothing
    Given user "victim-1" has two active identity.refresh_tokens rows
    When IdentityService.RevokeToken is called with an unsigned JWT whose payload is {"user_id":"victim-1"}
    Then both refresh_tokens rows for "victim-1" still have revoked_at NULL
    And RevokeToken with an expired but correctly signed token for "victim-1" sets revoked_at on both rows
    And the "identity.revoke.unverifiable" counter increases by 1 for the unsigned call and by 0 for the expired-signed call
