# Promoted from docs/roadmap/features/154-fundsignal-watchlist-universe/acceptance.feature at launch
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-154` tag.
# Durable business rules xstockstrat-analysis already guarantees — a rule enters only by promotion
# from a reviewed feature acceptance.feature, never by hand-authoring. These cover the fundamentals
# producer's universe resolution (universe_source, FMP-gated cap, portfolio-enumeration outage
# degradation) — distinct from the fundamentals producer's schedule guarantees.

Feature: Fundamentals signal producer — universe resolution
  How the producer resolves its per-cycle symbol universe from analysis.fundsignal.universe_source:
  the cross-user watchlist union, the explicit CSV, or their union — with an FMP-only symbol cap and
  crash-safe degradation when the portfolio enumeration is unavailable.

  @AC-3 @FR-3 @feature-154
  Scenario: Producer scores the enumerated union when universe_source is watchlists
    Given analysis.fundsignal.universe_source is "watchlists"
    And analysis.fundsignal.explicit_symbols is ""
    And the cross-user enumeration returns {"AAPL", "MSFT", "NVDA"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe is ["AAPL", "MSFT", "NVDA"]
    And it is not empty (no fallback to the empty explicit CSV)

  @AC-4 @FR-4 @feature-154
  Scenario: Producer unions enumeration with explicit_symbols when universe_source is both
    Given analysis.fundsignal.universe_source is "both"
    And analysis.fundsignal.explicit_symbols is "TSLA, AAPL"
    And the cross-user enumeration returns {"AAPL", "MSFT"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe is the de-duplicated union ["AAPL", "MSFT", "TSLA"]

  @AC-5 @FR-4 @feature-154
  Scenario: explicit source still ignores the enumeration entirely
    Given analysis.fundsignal.universe_source is "explicit"
    And analysis.fundsignal.explicit_symbols is "IBM"
    And the cross-user enumeration (if called) would return {"AAPL", "MSFT"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe is ["IBM"]
    And the enumeration RPC is not consulted

  @AC-6 @FR-5 @FR-7 @feature-154
  Scenario: The enumerated universe is capped only when FMP is the active provider
    Given analysis.fundsignal.universe_source is "watchlists"
    And the active fundamentals provider "marketdata.fundamentals.provider" is "fmp"
    And analysis.fundsignal.max_symbols_per_run is 2
    And the cross-user enumeration returns {"AAA", "BBB", "CCC"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe contains exactly 2 symbols
    And the surviving symbols are drawn from the de-duplicated enumerated set
    And a warning is logged naming the 1 dropped symbol

  @AC-7 @FR-6 @feature-154
  Scenario: A portfolio enumeration outage does not crash the producer cycle
    Given analysis.fundsignal.universe_source is "watchlists"
    And the cross-user enumeration RPC raises an UNAVAILABLE error
    When the fundamentals producer resolves its universe for a cycle
    Then the cycle completes without raising
    And the resolved universe is empty
    And a warning is logged naming the enumeration failure

  @AC-8 @FR-6 @feature-154
  Scenario: both + portfolio outage degrades to the explicit CSV
    Given analysis.fundsignal.universe_source is "both"
    And analysis.fundsignal.explicit_symbols is "TSLA, AAPL"
    And the cross-user enumeration RPC raises an UNAVAILABLE error
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe is ["AAPL", "TSLA"]
    And the cycle completes without raising
    And a warning is logged naming the enumeration failure

  @AC-9 @FR-7 @feature-154
  Scenario: A non-FMP active provider scores the whole union with no max_symbols truncation
    Given analysis.fundsignal.universe_source is "watchlists"
    And the active fundamentals provider "marketdata.fundamentals.provider" is "finnhub"
    And analysis.fundsignal.max_symbols_per_run is 2
    And the cross-user enumeration returns {"AAA", "BBB", "CCC"}
    When the fundamentals producer resolves its universe for a cycle
    Then the resolved universe contains all 3 symbols (no max_symbols truncation)
    And no symbol is permanently dropped
