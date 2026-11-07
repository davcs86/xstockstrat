package service

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric/noop"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/test/bufconn"

	"github.com/xstockstrat/portfolio/internal/telemetry"
)

// Feature 294 final allowlist pass (AC-41, AC-42, AC-7, AC-56). No t.Parallel(): these tests swap the
// process-global MeterProvider.

var allowedLabelKeys = map[string]bool{
	telemetry.KeyConsumer: true, telemetry.KeyOutcome: true, telemetry.KeyOp: true, telemetry.KeyMarkSource: true,
	telemetry.KeyPath: true,
}

var forbiddenLabelKeys = []string{
	"user_id", "email", "client_id", "account_id", "order_id", "intent_id", "symbol", "strategy_id",
	"stream_key", "slug", "category", "internal_caller", "secret", "api_key", "token",
}

var minInstruments = []string{
	"portfolio.consumer.events", "portfolio.marketdata_fetch", "portfolio.snapshot", "portfolio.mark_source",
}

var rpcServerKeys = []string{"rpc.system", "rpc.service", "rpc.method", "rpc.grpc.status_code"}

func driveAllInstruments(ctx context.Context) {
	for name := range consumerLoops {
		newConsumerSignal(name).handled(ctx, "ok", time.Now(), time.Now())
	}
	newConsumerSignal("unknown consumer").count(ctx, "error")
	telemetry.RecordMarketdataFetch(ctx, "quote", "timeout")
	telemetry.RecordSnapshot(ctx, "insert_failed")
	telemetry.RecordMarkSource(ctx, "quote", "get_portfolio")
}

// keysByInstrument collects every attribute key recorded on each collected instrument.
func keysByInstrument(t *testing.T, reader *sdkmetric.ManualReader) map[string]map[string]bool {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	out := map[string]map[string]bool{}
	add := func(name string, kvs []string) {
		if out[name] == nil {
			out[name] = map[string]bool{}
		}
		for _, k := range kvs {
			out[name][k] = true
		}
	}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			add(m.Name, nil)
			switch d := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, dp := range d.DataPoints {
					add(m.Name, attrKeys(dp.Attributes.ToSlice()))
				}
			case metricdata.Histogram[float64]:
				for _, dp := range d.DataPoints {
					add(m.Name, attrKeys(dp.Attributes.ToSlice()))
				}
			case metricdata.Gauge[float64]:
				for _, dp := range d.DataPoints {
					add(m.Name, attrKeys(dp.Attributes.ToSlice()))
				}
			}
		}
	}
	return out
}

func attrKeys(kvs []attribute.KeyValue) []string {
	keys := make([]string, 0, len(kvs))
	for _, kv := range kvs {
		keys = append(keys, string(kv.Key))
	}
	return keys
}

func TestAllowlist_AC41_EveryLabelKeyIsATelemetryConstant(t *testing.T) {
	reader := installMetricReader(t)
	driveAllInstruments(context.Background())
	got := keysByInstrument(t, reader)

	for _, name := range minInstruments {
		if _, ok := got[name]; !ok {
			t.Errorf("instrument %s not collected", name)
		}
	}
	for name, keys := range got {
		if strings.HasPrefix(name, "rpc.client.") {
			t.Errorf("AC-56: client instrument %q collected", name)
		}
		for k := range keys {
			if !allowedLabelKeys[k] {
				t.Errorf("%s carries label key %q outside the telemetry Key* constants", name, k)
			}
			for _, f := range forbiddenLabelKeys {
				if k == f {
					t.Errorf("%s carries forbidden label key %q", name, k)
				}
			}
		}
	}
}

func TestAllowlist_AC41_RPCServerDurationKeepsNameAndKeys(t *testing.T) {
	reader := installMetricReader(t)
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler()))
	healthpb.RegisterHealthServer(srv, health.NewServer())
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)
	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return lis.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if _, err := healthpb.NewHealthClient(conn).Check(context.Background(), &healthpb.HealthCheckRequest{}); err != nil {
		t.Fatalf("health check: %v", err)
	}

	// The server's stats End event can land after the client sees the reply, so poll.
	var keys map[string]bool
	deadline := time.Now().Add(2 * time.Second)
	for keys == nil && time.Now().Before(deadline) {
		keys = keysByInstrument(t, reader)["rpc.server.duration"]
		if keys == nil {
			time.Sleep(5 * time.Millisecond)
		}
	}
	if keys == nil {
		t.Fatal("rpc.server.duration not recorded")
	}
	for _, k := range rpcServerKeys {
		if !keys[k] {
			t.Errorf("rpc.server.duration lost attribute key %q (have %v)", k, keys)
		}
	}
	for _, f := range forbiddenLabelKeys {
		if keys[f] {
			t.Errorf("rpc.server.duration carries forbidden label key %q", f)
		}
	}
}

func TestAllowlist_AC42_DisabledInitInstallsNothingAndRecordsAreNoOps(t *testing.T) {
	t.Setenv("OTEL_ENABLED", "")
	prev := otel.GetMeterProvider()
	t.Cleanup(func() { otel.SetMeterProvider(prev) })
	np := noop.NewMeterProvider()
	otel.SetMeterProvider(np)

	shutdown, flush, err := telemetry.Init(context.Background())
	if err != nil {
		t.Fatalf("Init with OTEL_ENABLED unset = %v, want nil", err)
	}
	if otel.GetMeterProvider() != np {
		t.Error("Init with OTEL_ENABLED unset replaced the MeterProvider (an exporter was created)")
	}
	driveAllInstruments(context.Background())
	telemetry.LogTickOK(context.Background(), telemetry.LoopOrderFill, time.Second, "")
	if err := shutdown(context.Background()); err != nil {
		t.Errorf("no-op shutdown = %v", err)
	}
	if err := flush(context.Background()); err != nil {
		t.Errorf("no-op forceFlush = %v", err)
	}
}

func TestAllowlist_AC7_ClosedLoopSetAndConsumerLoopsStayInside(t *testing.T) {
	if len(telemetry.Loops) > 8 {
		t.Fatalf("len(telemetry.Loops) = %d, want <= 8", len(telemetry.Loops))
	}
	allowed := map[telemetry.Loop]bool{}
	for _, l := range telemetry.Loops {
		allowed[l] = true
	}
	for name, loop := range consumerLoops {
		if !allowed[loop] {
			t.Errorf("consumer %q writes loop %q outside telemetry.Loops", name, loop)
		}
	}
}
