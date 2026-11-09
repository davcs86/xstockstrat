# Promoted from docs/roadmap/features/295-fix-config-keys-drift/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-295` tag.
# Durable business rules xstockstrat-marketdata guarantees for live vendor-client config.

Feature: xstockstrat-marketdata - live vendor config
  What xstockstrat-marketdata guarantees: provider, rotated secrets and vendor-client settings take effect without a restart.

  @AC-7 @FR-7 @regression @feature-295
  Scenario: The fundamentals provider switches without a restart
    Given marketdata is running with "marketdata.fundamentals.provider" = "finnhub"
    When an operator sets it to "fmp"
    Then the next GetFundamentals call is served by the FMP client

  @AC-16 @FR-7 @regression @feature-295
  Scenario: A rotated vendor secret is used without a restart
    Given marketdata resolved "marketdata" / "fmp.api_key" at startup
    When an operator rotates it with SetConfig
    Then the next FMP request carries the rotated key

  @AC-32 @FR-7 @regression @feature-295
  Scenario Outline: Marketdata vendor-client settings and analysis's provider read change without a restart
    Given <service> is running with "<key>" = <old>
    When an operator sets it to <new>
    Then the next <call> uses <new>

    Examples:
      | service    | key                                | old       | new       | call                        |
      | marketdata | marketdata.backfill.rate_limit_rps | 200       | 50        | Alpaca bars request         |
      | marketdata | marketdata.edgar.user_agent        | "a/1"     | "b/2"     | EDGAR request User-Agent    |
      | analysis   | marketdata.fundamentals.provider   | "finnhub" | "fmp"     | fundamentals signal cycle   |
