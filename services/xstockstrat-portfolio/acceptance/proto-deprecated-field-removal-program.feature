# Promoted from docs/roadmap/features/196-proto-deprecated-field-removal-program/acceptance.feature at integration
# (Constitution C-16). Source-feature provenance is carried on every scenario's `@feature-196` tag.

Feature: xstockstrat-portfolio — Watchlist.symbols mirror is a KEEP field
  The deprecated-but-live Watchlist.symbols mirror stays populated; it is read in-repo.

  @AC-2 @FR-1 @regression @feature-196
  Scenario: a field with a live reader is never removed or omitted
    Given Watchlist.symbols has live readers (AddWatchlistSymbols' cap and the analysis live-loop legacy-row fallback)
    When any watchlist response is built
    Then Watchlist.symbols stays populated, mirroring every binding's symbol in order

  @AC-7 @FR-1 @regression @feature-196
  Scenario: the per-list cap is enforced from the symbols mirror
    Given a watchlist holding the maximum number of symbols per list
    When AddWatchlistSymbols adds one more symbol
    Then it fails with InvalidArgument because the cap counts existing.Symbols
