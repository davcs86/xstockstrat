package telemetry

import (
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel/metric/noop"
	"google.golang.org/grpc"
)

// ClientStatsHandler injects W3C traceparent on outbound RPCs. It records no rpc.client.* metrics:
// those are deliberately absent (see serverMetricViews), so the handler gets a noop MeterProvider.
func ClientStatsHandler() grpc.DialOption {
	return grpc.WithStatsHandler(otelgrpc.NewClientHandler(otelgrpc.WithMeterProvider(noop.NewMeterProvider())))
}
