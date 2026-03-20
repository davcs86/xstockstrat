package telemetry

import (
	"context"
	"os"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Init configures the global OTEL tracer provider and W3C trace-context propagator.
// Returns a shutdown function — call it on process exit.
// No-op when OTEL_ENABLED != "true".
//
// Note: OTLP trace/metric/log exporters require network access to install and are
// expected to be added in the next dependency update (see x-phase7-deviations.md).
// This bootstrap sets up context propagation and otelgrpc interceptors so that
// trace context flows correctly across service boundaries. When exporters are added,
// only otel.go needs updating — no changes to callers.
func Init(ctx context.Context, serviceName string) (shutdown func(context.Context) error, err error) {
	if os.Getenv("OTEL_ENABLED") != "true" {
		return func(context.Context) error { return nil }, nil
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName(serviceName)),
		resource.WithFromEnv(),
	)
	if err != nil {
		return nil, err
	}

	// TracerProvider with no exporter: enables trace context propagation and
	// otelgrpc instrumentation. Spans are created but not exported until
	// otlptracehttp is added as a dependency.
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{},
	))

	shutdown = func(ctx context.Context) error {
		return tp.Shutdown(ctx)
	}
	return shutdown, nil
}
