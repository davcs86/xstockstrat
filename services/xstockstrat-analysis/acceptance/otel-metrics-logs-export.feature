# Durable per-service business rules for xstockstrat-analysis, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-analysis exports its log records over OTLP/HTTP, correlated to the active trace.

  @AC-3 @FR-3 @regression @feature-274
  Scenario: An analysis log line inside a span reaches Loki correlated to its trace
    Given xstockstrat-analysis runs with OTEL_ENABLED="true"
    When a RunBacktest call with strategy_id="s-1" and symbols ["AAPL"] is handled
    Then the collector receives a POST to "/v1/logs" containing the INFO record "running backtest id=<backtest_id> strategy=s-1 symbols=['AAPL']"
    And the record's trace_id and span_id equal the RunBacktest server span's ids
    And the Loki query count_over_time({service_name="analysis"} |= "running backtest" [30m]) returns at least 1
