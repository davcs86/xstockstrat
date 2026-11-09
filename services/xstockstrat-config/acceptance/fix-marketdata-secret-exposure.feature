# Promoted from docs/roadmap/features/254-fix-marketdata-secret-exposure/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-254` tag.
# Durable business rules xstockstrat-config already guarantees - a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-config - the marketdata vendor secret grant is bound to the marketdata mTLS SAN
  GetSecret for the marketdata vendor keys requires both the x-internal-caller grant and the marketdata peer SAN (D-40).

  @AC-3 @FR-4 @regression @feature-254
  Scenario: The marketdata vendor secret is refused to a peer without the marketdata SAN
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" from an mTLS peer whose DNS SAN is "xstockstrat-ingest"
    Then the call fails with PERMISSION_DENIED
    And no plaintext value is returned

  @AC-4 @FR-5 @regression @feature-254
  Scenario: The marketdata service still resolves its vendor secret
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" from an mTLS peer whose DNS SAN is "xstockstrat-marketdata"
    Then the response has found true and value "alpaca-xyz"

  @AC-6 @FR-4 @regression @feature-254
  Scenario: The marketdata vendor secret is refused to a caller with no mTLS SAN
    Given config holds secret "marketdata/alpaca.api_key" = "alpaca-xyz"
    When GetSecret is called for namespace "marketdata" key "alpaca.api_key" with header x-internal-caller "marketdata" and no peer SAN
    Then the call fails with PERMISSION_DENIED
    And no plaintext value is returned
    # Replaces the "no SAN required" assertion at services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts:236.
