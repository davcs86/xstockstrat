package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/metric"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.25.0"
)

// logProviderInstalled is set by Init once the global LoggerProvider is in place; WrapLogHandler
// returns its base handler untouched until then.
var logProviderInstalled atomic.Bool

// meterGen is bumped by Init after it installs its MeterProvider; bound instruments rebind when it
// or the global provider's identity changes.
var meterGen atomic.Uint64

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
	meterGen.Add(1)

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
	return "portfolio"
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

// sameProvider never panics, even when a provider's dynamic type is not comparable.
func sameProvider(a, b metric.MeterProvider) (same bool) {
	defer func() {
		if recover() != nil {
			same = false
		}
	}()
	return a == b
}

type bound[T any] struct {
	provider metric.MeterProvider
	gen      uint64
	inst     T
}

// binding caches one instrument for the MeterProvider and meterGen it was created against.
type binding[T any] struct{ cur atomic.Pointer[bound[T]] }

func (b *binding[T]) get(create func(metric.Meter) (T, error)) (T, bool) {
	var zero T
	p := otel.GetMeterProvider()
	if p == nil {
		return zero, false
	}
	gen := meterGen.Load()
	if c := b.cur.Load(); c != nil && c.gen == gen && sameProvider(c.provider, p) {
		return c.inst, true
	}
	inst, err := create(p.Meter(serviceName()))
	if err != nil {
		return zero, false
	}
	b.cur.Store(&bound[T]{provider: p, gen: gen, inst: inst})
	return inst, true
}

// Counter is an Int64Counter that rebinds when the global MeterProvider changes.
type Counter struct {
	name string
	opts []metric.Int64CounterOption
	b    binding[metric.Int64Counter]
}

func NewCounter(name string, opts ...metric.Int64CounterOption) *Counter {
	return &Counter{name: name, opts: opts}
}

func (c *Counter) Add(ctx context.Context, n int64, attrs ...attribute.KeyValue) {
	if c == nil {
		return
	}
	inst, ok := c.b.get(func(m metric.Meter) (metric.Int64Counter, error) {
		return m.Int64Counter(c.name, c.opts...)
	})
	if ok {
		inst.Add(ctx, n, metric.WithAttributes(attrs...))
	}
}

// Histogram is a Float64Histogram that rebinds when the global MeterProvider changes.
type Histogram struct {
	name string
	opts []metric.Float64HistogramOption
	b    binding[metric.Float64Histogram]
}

func NewHistogram(name string, opts ...metric.Float64HistogramOption) *Histogram {
	return &Histogram{name: name, opts: opts}
}

func (h *Histogram) Record(ctx context.Context, v float64, attrs ...attribute.KeyValue) {
	if h == nil {
		return
	}
	inst, ok := h.b.get(func(m metric.Meter) (metric.Float64Histogram, error) {
		return m.Float64Histogram(h.name, h.opts...)
	})
	if ok {
		inst.Record(ctx, v, metric.WithAttributes(attrs...))
	}
}

// Gauge is a Float64ObservableGauge; observe reports a sample only when its bool is true.
type Gauge struct {
	name    string
	observe func(context.Context) (float64, bool)
	opts    []metric.Float64ObservableGaugeOption

	mu       sync.Mutex
	provider metric.MeterProvider
	gen      uint64
	reg      metric.Registration
}

func NewGauge(name string, observe func(context.Context) (float64, bool), opts ...metric.Float64ObservableGaugeOption) *Gauge {
	return &Gauge{name: name, observe: observe, opts: opts}
}

// Register is idempotent per provider; a provider change moves the callback to the new provider.
func (g *Gauge) Register() {
	if g == nil || g.observe == nil {
		return
	}
	p := otel.GetMeterProvider()
	if p == nil {
		return
	}
	gen := meterGen.Load()
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.reg != nil && g.gen == gen && sameProvider(g.provider, p) {
		return
	}
	m := p.Meter(serviceName())
	inst, err := m.Float64ObservableGauge(g.name, g.opts...)
	if err != nil {
		return
	}
	reg, err := m.RegisterCallback(func(ctx context.Context, o metric.Observer) error {
		if v, ok := g.observe(ctx); ok {
			o.ObserveFloat64(inst, v)
		}
		return nil
	}, inst)
	if err != nil {
		return
	}
	if g.reg != nil {
		_ = g.reg.Unregister()
	}
	g.provider, g.gen, g.reg = p, gen, reg
}

// Loop names a background loop; each service declares its closed constant set and Loops slice.
type Loop string

// LoopTickOKMsg is the liveness record's message; operators match on this exact text.
const LoopTickOKMsg = "loop tick ok"

// LogTickOK takes a duration, not a start time, so the caller's clock seam controls duration_ms.
func LogTickOK(ctx context.Context, loop Loop, d time.Duration, state string) {
	args := []any{"loop", string(loop), "duration_ms", d.Milliseconds()}
	if state != "" {
		args = append(args, "state", state)
	}
	slog.InfoContext(ctx, LoopTickOKMsg, args...)
}

// tickThrottleInterval is a fixed invariant (design.md 1.13), not a config key.
const tickThrottleInterval = 60 * time.Second

// TickThrottle is a leading-edge limiter and is not safe for concurrent use.
type TickThrottle struct{ last time.Time }

func (t *TickThrottle) Allow(now time.Time) bool {
	if !t.last.IsZero() && now.Sub(t.last) < tickThrottleInterval {
		return false
	}
	t.last = now
	return true
}

// Portfolio label keys; a recorded attribute key outside this set fails the allowlist test.
const (
	KeyConsumer   = "consumer"
	KeyOutcome    = "outcome"
	KeyOp         = "op"
	KeyMarkSource = "mark_source"
	KeyPath       = "path"
)

// Portfolio loop names. LoopSignalPrune keeps its own "signal watchlist prune tick" record and is
// never written through LogTickOK.
const (
	LoopOrderFill      Loop = "order_fill"
	LoopPositionSync   Loop = "position_sync"
	LoopDeregistration Loop = "deregistration"
	LoopBracket        Loop = "bracket"
	LoopBalance        Loop = "balance"
	LoopSignalPrune    Loop = "signal_prune"
)

var Loops = []Loop{LoopOrderFill, LoopPositionSync, LoopDeregistration, LoopBracket, LoopBalance, LoopSignalPrune}

var (
	consumerEvents  = NewCounter("portfolio.consumer.events")
	marketdataFetch = NewCounter("portfolio.marketdata_fetch")
	snapshotOutcome = NewCounter("portfolio.snapshot")
	markSource      = NewCounter("portfolio.mark_source")
)

func RecordConsumerEvent(ctx context.Context, consumer, outcome string) {
	consumerEvents.Add(ctx, 1, attribute.String(KeyConsumer, consumer), attribute.String(KeyOutcome, outcome))
}

func RecordMarketdataFetch(ctx context.Context, op, outcome string) {
	marketdataFetch.Add(ctx, 1, attribute.String(KeyOp, op), attribute.String(KeyOutcome, outcome))
}

func RecordSnapshot(ctx context.Context, outcome string) {
	snapshotOutcome.Add(ctx, 1, attribute.String(KeyOutcome, outcome))
}

func RecordMarkSource(ctx context.Context, source, path string) {
	markSource.Add(ctx, 1, attribute.String(KeyMarkSource, source), attribute.String(KeyPath, path))
}
