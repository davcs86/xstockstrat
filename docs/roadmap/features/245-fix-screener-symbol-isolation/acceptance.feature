Feature: fix-screener-symbol-isolation (bug fix)
  Regression guard for docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md:
  ScreenSymbols fails entirely when one symbol raises a non-RpcError.

  @AC-1 @regression
  Scenario Outline: One symbol's non-RPC failure degrades only that symbol's row
    Given a ScreenSymbols request over 50 symbols with a SIGNAL criterion and rank_limit 50
    And every symbol has at least 2 daily bars and an active signal
    And <failure_site> raises <exception> for symbol "BAD" only
    When the caller invokes ScreenSymbols
    Then the RPC returns OK
    And the response contains a result row for each of the other 49 symbols with its computed score
    And "BAD" does not rank above any of the other 49 symbols
    And a WARN log names "BAD"

    Examples:
      | failure_site                     | exception         |
      | scoring.compute_signal_score     | ZeroDivisionError |
      | the per-symbol technical value   | ArithmeticError   |

  @AC-2 @regression
  Scenario: The scan deadline still cancels the whole scan
    Given analysis.screener.max_duration_seconds is 1
    And one symbol's evaluation never completes
    When the caller invokes ScreenSymbols over 50 symbols
    Then ScreenSymbols fails with gRPC status DEADLINE_EXCEEDED and message "screen exceeded 1s deadline"
    And the cancellation is not converted into a degraded row

  @AC-3 @regression
  Scenario: An unknown fundamental metric is still rejected for the whole request
    Given a ScreenSymbols request with a FUNDAMENTAL criterion whose metric_name is "not_a_metric"
    And fundamentals are available for the universe
    When the caller invokes ScreenSymbols
    Then ScreenSymbols fails with gRPC status INVALID_ARGUMENT
