package telemetry

import (
	"context"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.25.0"
)

// Init initialises the global OTel TracerProvider and returns a shutdown function.
// When OTEL_ENABLED is not "true" it returns a no-op immediately.
func Init(ctx context.Context) (func(context.Context) error, error) {
	if os.Getenv("OTEL_ENABLED") != "true" {
		return func(context.Context) error { return nil }, nil
	}

	// No endpoint/insecure options: they override OTEL_EXPORTER_OTLP_* (path, TLS, headers).
	exp, err := otlptracehttp.New(ctx, otlptracehttp.WithTimeout(5*time.Second))
	if err != nil {
		return nil, err
	}

	res, err := newResource(ctx)
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	return tp.Shutdown, nil
}

// newResource builds the sole OTel Resource input to Init (its omissions are guarded by
// TestNewResourceOmitsTradingMode).
func newResource(ctx context.Context) (*resource.Resource, error) {
	svcName := os.Getenv("SERVICE_NAME")
	if svcName == "" {
		svcName = "trading"
	}
	return resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(svcName),
			semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")),
			attribute.String("platform", "xstockstrat"),
		),
	)
}
