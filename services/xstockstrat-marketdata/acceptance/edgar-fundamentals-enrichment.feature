# Promoted from docs/roadmap/features/211-edgar-fundamentals-enrichment/acceptance.feature
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-211` tag.
# Durable business rules xstockstrat-marketdata already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring.
#
# This suite is the marketdata service's FIRST fundamentals-serving guard (recon: no promoted
# marketdata fundamentals-serving/currency suite existed before feature 211). Each scenario is backed
# by a unit assertion: @AC-1 edgar_client_test currency capture; @AC-2/@AC-3 edgar_client_test
# financial-debt D/E; @AC-4 marketdata_service_test priceJoin no-look-ahead; @AC-5
# marketdata_service_test T12M dividend window (live Alpaca entitlement verified post-deploy via the
# audit logs — the unit test drives a fake dividend source); @AC-6/@AC-7 marketdata_service_test
# snapshot dispatch + disable-safety + vendor fallback; @AC-9 the same-stored-period parity the
# snapshot builder guarantees by construction. @AC-8 is the UI (data-explorer) surface of the same data.

Feature: xstockstrat-marketdata — SEC EDGAR point-in-time fundamentals enrichment
  Backtest fundamentals and live fundamentals come from one PIT-faithful EDGAR source computed the
  same way (true reporting currency, financial-debt debt-to-equity, currency-consistent P/B,
  trailing-12-month dividend yield), so a fundamentals-gated strategy's backtest result and its live
  Decide-surface signal agree.

  @AC-1 @FR-1 @feature-211
  Scenario: A CNY-reporting ADR filing records its true reporting currency, not USD
    Given BABA's FY2026 EDGAR companyfacts report monetary facts under the XBRL unit key "CNY"
    When the historical fundamentals backfill ingests BABA's FY2026 period
    Then the stored fundamentals_history row for BABA FY2026 has currency "CNY"
    And the reporting currency is no longer unconditionally "USD"

  @AC-2 @FR-2 @feature-211
  Scenario: Debt-to-equity uses the financial-debt convention, not total liabilities
    Given BABA's FY2026 filing reports StockholdersEquity of 153,796M USD (1,060,886M CNY), total Liabilities of 113,555M USD, and financial debt (ConvertibleDebtNoncurrent, its short/long-term borrowings having ceased after FY2018/FY2019) of ~8,098M USD
    When the EDGAR ingester computes debt_to_equity for BABA FY2026
    Then debt_to_equity is total_debt / equity in the financial-debt convention (~0.05), not the total-liabilities ratio (~0.74)
    And debt_to_equity is well below the seeded formula band de_bad = 2.0

  @AC-3 @FR-2 @feature-211
  Scenario: A financial-sector filer no longer permanently zeros its D/E sub-score
    Given AXP's latest EDGAR filing whose total-liabilities/equity would exceed de_bad = 2.0
    When the EDGAR ingester computes debt_to_equity from AXP's financial-debt line items
    Then the debt_to_equity value produces a non-zero D/E quality sub-score under the seeded formula bands

  @AC-4 @FR-3 @FR-7 @feature-211
  Scenario: P/B is computed at the filing boundary with no look-ahead
    Given BABA's FY2025 period filed 2025-06-26 with StockholdersEquity in CNY and shares outstanding present
    When priceJoin enriches the period using only the price as of the filing date 2025-06-26
    Then pb_ratio equals market_cap / stockholders_equity computed in a single consistent currency
    And no price observed after 2025-06-26 contributes to that period's pb_ratio

  @AC-5 @FR-4 @FR-7 @feature-211
  # The live Alpaca corporate-actions entitlement is verified post-deploy via the audit logs (operator
  # decision recorded in context.md); the unit assertion drives a fake dividend source.
  Scenario: Dividend yield is trailing-12-month and excludes post-filing payments
    Given a symbol that paid cash dividends on 2024-08-01 and 2025-02-01 and again on 2025-08-15, and a filing filed 2025-06-26
    When dividend_yield is computed for the 2025-06-26 filing period
    Then only the 2024-08-01 and 2025-02-01 payments (ex/pay date on or before 2025-06-26) are summed for the trailing-12-month numerator
    And the 2025-08-15 payment is excluded because it post-dates the filing

  @AC-6 @FR-5 @FR-8 @feature-211
  Scenario: The snapshot path serves the latest EDGAR filing after the vendors are disabled
    Given marketdata.finnhub.enabled = false and marketdata.fmp.enabled = false and EDGAR-canonical snapshot selected
    When GetFundamentalsMulti is called for BABA
    Then the returned snapshot is derived from BABA's latest EDGAR filing enriched with a live price-join
    And the snapshot debt_to_equity uses the same financial-debt convention as the historical periods
    And fundamentals are still served (the disable did not fall through to an empty/false default)

  @AC-7 @FR-5 @feature-211
  Scenario: A non-SEC-filing symbol falls back to the vendor path
    Given a symbol with no EDGAR CIK (no SEC filing) while EDGAR is the canonical snapshot source
    When GetFundamentalsMulti is called for that symbol
    Then the vendor fallback supplies its snapshot fundamentals
    And the response source marks the row as vendor-sourced rather than edgar

  @AC-8 @FR-6 @feature-211
  Scenario: The data explorer shows the enriched metrics with currency and provenance
    Given BABA has enriched historical fundamentals after a backfill
    When a user opens /insights/data-explorer for BABA and views the Historical fundamentals tab
    Then the table shows debt_to_equity, pb_ratio, and dividend_yield populated (not "—") for periods that carry them
    And each period displays its reporting currency (e.g. "CNY") and its source (e.g. "edgar")

  @AC-9 @FR-1 @FR-2 @FR-3 @FR-4 @feature-211
  Scenario: Backtest PIT composite lands in the same band as the live snapshot after enrichment
    Given BABA's enriched PIT fundamentals for the backtest window and the same-convention live snapshot
    When the seeded fundamentals_value_quality formula scores fscore.composite on both surfaces
    Then the PIT period and the EDGAR snapshot for the same filing carry the same debt_to_equity, pb_ratio, and currency
    And the PIT composite and the live composite fall within the same band (no ~0.35 vs ~0.70 split)
    And a fundamentals_macd_blend backtest and its live Decide-surface signal no longer contradict on the fscore gate
