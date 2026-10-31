# Durable per-service business rules for xstockstrat-ui, promoted from feature 274's
# acceptance.feature at launch (Constitution C-16). Source-feature provenance is carried on every
# scenario's `@feature-274` tag. These are the guarantees a future feature must not silently break.

Feature: otel-metrics-logs-export
  xstockstrat-ui records BFF route durations for unary and REST calls only.

  @AC-16 @FR-1 @regression @feature-274
  Scenario: The UI records BFF route durations for unary and REST calls only
    Given xstockstrat-ui runs with OTEL_ENABLED="true"
    When a unary /trader Connect call to TradingService returns 200, GET /accounts/api/profile returns 200, and a StreamAlerts subscription stays open for 60 seconds
    Then http.server.duration has a data point with xstk.segment="trader", rpc.service="xstockstrat.trading.v1.TradingService", http.response.status_code=200
    And a data point with xstk.segment="accounts", http.route="/accounts/api/profile", http.response.status_code=200
    And no data point carries rpc.service="xstockstrat.notify.v1.NotifyService" for the open StreamAlerts call
