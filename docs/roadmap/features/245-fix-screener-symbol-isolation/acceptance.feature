Feature: fix-screener-symbol-isolation (bug fix)
  Regression guard for docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md:
  ScreenSymbols fails entirely when one symbol raises a non-RpcError.

  @AC-1 @FR-1 @regression
  Scenario Outline: One symbol's non-RPC failure degrades only that symbol's row
    Given a ScreenSymbols request over 50 symbols with signal_sources ["fundamentals"], signal_weight 1, technical_weight 1, and rank_limit 50
    And its criteria are a SCREEN_KIND_SIGNAL criterion "sig" and a SCREEN_KIND_TECHNICAL_INDICATOR criterion "rsi" with component indicator "RSI", neither a hard filter
    And every symbol has at least 2 daily bars and at least one active "fundamentals" signal
    And <failure_site> raises <exception> for symbol "BAD" only
    When the caller invokes ScreenSymbols
    Then the RPC returns OK
    And the response contains a result row for each of the other 49 symbols with its computed score
    And "BAD" does not rank above any of the other 49 symbols
    And "BAD"'s row, if present, has passed false and score_unavailable true, and its status is not SCREEN_RESULT_STATUS_INSUFFICIENT_DATA
    And a WARN log names "BAD"

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
    Given a ScreenSymbols request over symbols ["AAPL", "MSFT"] with a FUNDAMENTAL criterion whose metric_name is "not_a_metric"
    And fundamentals are available for "AAPL" and "MSFT", and neither carries an extra_metrics key "not_a_metric"
    When the caller invokes ScreenSymbols
    Then ScreenSymbols fails with gRPC status INVALID_ARGUMENT
    And no ScreenResult rows are returned
