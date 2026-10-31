# Durable per-service business rules for xstockstrat-indicators, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-indicators maps Python deadline and cancel outcomes to Go gRPC status codes in the RPC duration metric.

  @AC-22 @FR-2 @regression @feature-274
  Scenario: Python deadline and cancel map to Go's status codes
    Given xstockstrat-indicators runs with OTEL_ENABLED="true"
    When a client calls a unary RPC with a 50 ms deadline that the handler outlives, and another client cancels an in-flight call
    Then rpc.server.duration records rpc.grpc.status_code=4 for the first call and 1 for the second
