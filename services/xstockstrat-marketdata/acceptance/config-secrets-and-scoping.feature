# Promoted from docs/roadmap/features/147-config-secrets-and-scoping/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-147` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.

Feature: xstockstrat-marketdata — vendor credentials resolved from encrypted config
  What marketdata guarantees now that its Alpaca/FMP/Finnhub credentials come from encrypted config
  (via GetSecret) instead of environment variables.

  @AC-6 @FR-5 @feature-147
  Scenario: marketdata resolves a vendor credential from config, not the env var
    Given ALPACA_API_KEY is unset in the marketdata process environment
    And "marketdata.alpaca.api_key" is stored as an encrypted secret with plaintext "alpaca-key-xyz"
    When marketdata starts and initializes its Alpaca client in environment "production"
    Then marketdata resolves the key "alpaca-key-xyz" via GetSecret
    And marketdata makes no read of os environment variable "ALPACA_API_KEY"

  @AC-7 @FR-6 @feature-147
  Scenario: A missing Alpaca credential warns but marketdata still starts
    Given environment "production" has no stored value for "marketdata.alpaca.api_key"
    When marketdata starts and resolves the credential via GetSecret
    Then marketdata logs the same looksLikePlaceholderCred warning it logged when the env var was empty
    And marketdata still starts (cached reads and non-Alpaca paths keep working), exactly as today
