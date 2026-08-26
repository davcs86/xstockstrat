Feature: Signal-weighted screening reads the correct bar-time proto field (feature 160)
  Regression guard promoted from feature 160's acceptance scenarios: signal-weighted
  ScreenSymbols crashed because scoring read bar.timestamp (the marketdata Bar proto
  field is bar.time). These guarantees must never silently regress.

  @AC-1 @regression @feature-160
  Scenario: A signal-weighted screen returns results instead of crashing
    Given ScreenSymbols is called for symbols ["AARD", "BABA", "WLTH"] with signal_sources ["fundamentals"], signal_weight 1, and technical_weight 0
    And each symbol has at least one OHLCV bar (whose time field is set) and at least one active fundamentals signal
    When the screen runs
    Then it returns a ranked result per symbol with status "SCREEN_RESULT_STATUS_OK"
    And it does NOT raise "AttributeError: timestamp" / a gRPC UNKNOWN

  @AC-2 @regression @feature-160
  Scenario: compute_signal_score reads the bar time from the correct proto field
    Given a marketdata Bar whose candle time is carried in its "time" field (there is no "timestamp" field)
    When compute_signal_score is invoked with a non-empty signals_map and signal_sources
    Then it reads the bar's "time" field for the reference timestamp and returns a 0.0–1.0 score
    And it never accesses a "timestamp" attribute on the bar
