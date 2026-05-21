package telemetry

import (
	"context"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
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

	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		endpoint = "otel-collector:4317"
	}

	exp, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(endpoint),
		otlptracegrpc.WithInsecure(),
		otlptracegrpc.WithTimeout(5*time.Second),
	)
	if err != nil {
		return nil, err
	}

	svcName := os.Getenv("SERVICE_NAME")
	if svcName == "" {
		svcName = "portfolio"
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(svcName),
			semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")),
			attribute.String("trading_mode", os.Getenv("TRADING_MODE")),
			attribute.String("platform", "xstockstrat"),
		),
	)
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
