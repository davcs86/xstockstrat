package telemetry

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.25.0"
)

// logProviderInstalled is set by Init once the global LoggerProvider is in place; WrapLogHandler
// returns its base handler untouched until then.
var logProviderInstalled atomic.Bool

// Init initialises the global OTel trace, metric and log providers and returns a shutdown and a
// forceFlush function. When OTEL_ENABLED is not "true" it returns two no-ops immediately. Any
// exporter-construction error returns (nil, nil, err) with nothing installed, so callers stay non-fatal.
func Init(ctx context.Context) (shutdown func(context.Context) error, forceFlush func(context.Context) error, err error) {
	noop := func(context.Context) error { return nil }
	if os.Getenv("OTEL_ENABLED") != "true" {
		return noop, noop, nil
	}

	// No endpoint/insecure options on any exporter: they override OTEL_EXPORTER_OTLP_* (path, TLS, headers).
	texp, err := otlptracehttp.New(ctx, otlptracehttp.WithTimeout(5*time.Second))
	if err != nil {
		return nil, nil, err
	}
	mexp, err := otlpmetrichttp.New(ctx)
	if err != nil {
		return nil, nil, err
	}
	lexp, err := otlploghttp.New(ctx)
	if err != nil {
		return nil, nil, err
	}

	res, err := newResource(ctx)
	if err != nil {
		return nil, nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(texp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(mexp)),
		sdkmetric.WithResource(res),
		sdkmetric.WithView(serverMetricViews()...),
	)
	otel.SetMeterProvider(mp)

	lp := sdklog.NewLoggerProvider(
		sdklog.WithProcessor(sdklog.NewBatchProcessor(lexp)),
		sdklog.WithResource(res),
	)
	global.SetLoggerProvider(lp)
	logProviderInstalled.Store(true)

	shutdown = func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx), lp.Shutdown(ctx))
	}
	forceFlush = func(ctx context.Context) error {
		return errors.Join(tp.ForceFlush(ctx), mp.ForceFlush(ctx), lp.ForceFlush(ctx))
	}
	return shutdown, forceFlush, nil
}

// serverMetricViews keeps only `rpc.server.duration`, the instrument otelgrpc's server handler
// creates, by dropping its four size/count siblings (cardinality, design PR-A Views).
func serverMetricViews() []sdkmetric.View {
	dropped := []string{
		"rpc.server.request.size",
		"rpc.server.response.size",
		"rpc.server.requests_per_rpc",
		"rpc.server.responses_per_rpc",
	}
	views := make([]sdkmetric.View, 0, len(dropped))
	for _, name := range dropped {
		views = append(views, sdkmetric.NewView(
			sdkmetric.Instrument{Name: name},
			sdkmetric.Stream{Aggregation: sdkmetric.AggregationDrop{}},
		))
	}
	return views
}

// serviceName is the SERVICE_NAME default shared by newResource and the log bridge.
func serviceName() string {
	if n := os.Getenv("SERVICE_NAME"); n != "" {
		return n
	}
	return "marketdata"
}

// newResource builds the sole OTel Resource input to Init (its omissions are guarded by
// TestNewResourceOmitsTradingMode).
func newResource(ctx context.Context) (*resource.Resource, error) {
	return resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(serviceName()),
			semconv.DeploymentEnvironment(os.Getenv("APPLICATION_ENV")),
			attribute.String("platform", "xstockstrat"),
		),
	)
}
