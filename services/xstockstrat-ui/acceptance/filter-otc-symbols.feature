# Promoted from docs/roadmap/features/282-filter-otc-symbols/acceptance.feature at launch
# (Constitution C-16). Scenarios are verbatim; @AC-/@FR- tags are preserved and @feature-282 added.
# Durable business rules xstockstrat-ui guarantees for refused-symbol notices and rename behaviour.

Feature: xstockstrat-ui — filter OTC symbols
  UI watchlist controls surface refused symbols with reasons and never drop stored symbols on rename.

  @AC-20 @FR-2 @feature-282
  Scenario: The UI add controls show each refused symbol with its reason
    Given CRTD is unservable and MSFT is servable
    When the user adds CRTD and MSFT in the watchlist detail, or uses screener save-as or Add top N
    Then MSFT is added
    And a notice lists CRTD with its reason

  @AC-21 @FR-2 @feature-282
  Scenario: Renaming a watchlist in the UI never drops or refuses stored symbols
    Given watchlist "core" stores CRTD and MSFT and CRTD is unservable
    When the user renames "core" in the UI
    Then the update is sent with the field mask "name"
    And both symbols stay stored and nothing is refused
