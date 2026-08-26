Feature: fix-signal-screen-crash (bug fix)
  Regression guard for the defect recorded at
  docs/reports/2026-08-26-signal-screen-bar-timestamp-crash-defect.md:
  signal-weighted ScreenSymbols crashed because scoring read bar.timestamp (proto field is bar.time).

  @AC-1 @regression
  Scenario: A signal-weighted screen returns results instead of crashing
    Given ScreenSymbols is called for symbols ["AARD", "BABA", "WLTH"] with signal_sources ["fundamentals"], signal_weight 1, and technical_weight 0
    And each symbol has at least one OHLCV bar (whose time field is set) and at least one active fundamentals signal
    When the screen runs
    Then it returns a ranked result per symbol with status "SCREEN_RESULT_STATUS_OK"
    And it does NOT raise "AttributeError: timestamp" / a gRPC UNKNOWN

  @AC-2 @regression
  Scenario: compute_signal_score reads the bar time from the correct proto field
    Given a marketdata Bar whose candle time is carried in its "time" field (there is no "timestamp" field)
    When compute_signal_score is invoked with a non-empty signals_map and signal_sources
    Then it reads the bar's "time" field for the reference timestamp and returns a 0.0–1.0 score
    And it never accesses a "timestamp" attribute on the bar
