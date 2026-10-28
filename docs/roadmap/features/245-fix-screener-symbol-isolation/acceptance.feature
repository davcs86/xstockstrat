Feature: fix-screener-symbol-isolation (bug fix)
  Regression guard for docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md:
  ScreenSymbols fails entirely when one symbol raises a non-RpcError.

  @AC-1 @FR-1 @regression
  Scenario Outline: One symbol's non-RPC failure degrades only that symbol's row
    Given a ScreenSymbols request over 50 symbols with signal_sources ["fundamentals"], signal_weight 1, technical_weight 1, and rank_limit 50
    And its criteria are a SCREEN_KIND_SIGNAL criterion "sig" and a SCREEN_KIND_TECHNICAL_INDICATOR criterion "rsi" with component indicator "RSI", neither a hard filter
    And every symbol has at least 2 daily bars and at least one active "fundamentals" signal
    And the symbols' signal convictions and RSI readings differ, and "BAD" holds the highest signal conviction
    And <failure_site> raises <exception> for symbol "BAD" only
    When the caller invokes ScreenSymbols
    Then the RPC returns OK
    And the response contains a result row for each of the other 49 symbols, each equal to that symbol's row when the same request runs over those 49 symbols without "BAD"
    And "BAD"'s row is present with status SCREEN_RESULT_STATUS_OK, passed false, score_unavailable true and no criterion_scores
    And "BAD" ranks after every one of the other 49 symbols
    And exactly one WARN log line names "BAD" with its exception type

    Examples:
      | failure_site                     | exception         |
      | scoring.compute_signal_score     | ZeroDivisionError |
      | ScreenerEngine._technical_value  | ArithmeticError   |
      | ScreenerEngine._latest_indicator | ValueError        |

  @AC-2 @FR-2 @regression
  Scenario: The scan deadline still cancels the whole scan
    Given analysis.screener.max_duration_seconds is 1
    And the marketdata GetBars call for one symbol never returns
    When the caller invokes ScreenSymbols over 50 symbols
    Then ScreenSymbols fails with gRPC status DEADLINE_EXCEEDED and message "screen exceeded 1s deadline"
    And no ScreenResult rows are returned

  @AC-3 @FR-3 @regression
  Scenario: An unknown fundamental metric is still rejected for the whole request
    Given a ScreenSymbols request over symbols ["AAPL", "MSFT"] with a SCREEN_KIND_FUNDAMENTAL criterion whose metric_name is "not_a_metric"
    And fundamentals are available for "AAPL" and "MSFT", and neither carries an extra_metrics key "not_a_metric"
    When the caller invokes ScreenSymbols
    Then ScreenSymbols fails with gRPC status INVALID_ARGUMENT
    And no ScreenResult rows are returned

  @AC-4 @FR-4 @regression
  Scenario: The single-symbol Screening section shows "Not evaluated" for a score-unavailable row
    Given a trader opens /trader/positions/AAPL and AAPL is not on any watchlist, so the Screening section renders
    And ScreenSymbols returns one row for "AAPL" with status SCREEN_RESULT_STATUS_OK, passed false and score_unavailable true
    When the trader runs the screen
    Then the Screening section shows the "Not evaluated" notice
    And it shows neither the per-criterion results table nor the "Insufficient data" notice

  @AC-5 @FR-1 @regression
  Scenario: The agent screen_symbols result carries score_unavailable on every row
    Given ScreenSymbols returns a row for "NVDA" with passed true and score_unavailable false
    And a row for "BAD" with status SCREEN_RESULT_STATUS_OK, passed false and score_unavailable true
    When the agent calls screen_symbols
    Then every result dict carries a boolean "score_unavailable"
    And the "BAD" result has "passed" false and "score_unavailable" true
