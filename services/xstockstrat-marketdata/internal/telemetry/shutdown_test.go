package telemetry

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"testing"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	collogs "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	colmetrics "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
)

func TestStopServerFlushesBeforeGracefulStop(t *testing.T) {
	var order []string
	StopServer(
		func(context.Context) error { order = append(order, "flush"); return nil },
		func() { order = append(order, "graceful") },
		func() { order = append(order, "force") },
		time.Second, time.Second,
	)
	if len(order) != 2 || order[0] != "flush" || order[1] != "graceful" {
		t.Fatalf("call order = %v, want [flush graceful] and no force", order)
	}
}

func TestStopServerForcesWhenGracefulNeverReturns(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	forced := make(chan struct{})
	start := time.Now()
	StopServer(
		func(context.Context) error { return nil },
		func() { <-release },
		func() { close(forced) },
		time.Second, 50*time.Millisecond,
	)
	select {
	case <-forced:
	default:
		t.Fatal("force was not called after gracefulTimeout")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("StopServer took %s, want about the 50ms graceful timeout", elapsed)
	}
}

func TestStopServerToleratesNilForceFlush(t *testing.T) {
	called := false
	StopServer(nil, func() { called = true }, func() {}, time.Second, time.Second)
	if !called {
		t.Fatal("graceful was not called when forceFlush is nil")
	}
}

func TestStopServerReportsFailedFlushThroughOTelErrorHandler(t *testing.T) {
	var got error
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) { got = err }))
	t.Cleanup(func() { useStdlibLogErrorHandler(t) })

	want := errors.New("flush failed")
	graceful := false
	StopServer(
		func(context.Context) error { return want },
		func() { graceful = true },
		func() {},
		time.Second, time.Second,
	)
	if !errors.Is(got, want) {
		t.Fatalf("error handler received %v, want %v", got, want)
	}
	if !graceful {
		t.Fatal("a failed flush must not skip the graceful stop")
	}
}

// TestShutdownFlushesTelemetryWithinBoundWhileStreamOpen is AC-12/AC-18: with a server stream held open
// (which blocks GracefulStop forever), the metrics and logs recorded before SIGTERM are still exported
// and the whole stop sequence returns inside the 10 s container grace period.
func TestShutdownFlushesTelemetryWithinBoundWhileStreamOpen(t *testing.T) {
	rc := newOTLPReceiver(t, http.StatusOK)
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "600000") // no periodic export: only the stop path can deliver
	shutdown, forceFlush := startTelemetry(t, rc.url(), rawHeaders)

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
	hc := healthpb.NewHealthClient(conn)

	watchCtx, cancelWatch := context.WithCancel(context.Background())
	t.Cleanup(cancelWatch)
	stream, err := hc.Watch(watchCtx, &healthpb.HealthCheckRequest{})
	if err != nil {
		t.Fatalf("watch: %v", err)
	}
	if _, err := stream.Recv(); err != nil {
		t.Fatalf("first watch message: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := hc.Check(context.Background(), &healthpb.HealthCheckRequest{}); err != nil {
			t.Fatalf("check %d: %v", i, err)
		}
	}
	logger := slog.New(WrapLogHandler(slog.DiscardHandler))
	for _, msg := range []string{"rec-1", "rec-2", "rec-3"} {
		logger.Info(msg)
	}
	// Unary durations are recorded from a deferred stats event: wait until both Check calls are counted.
	waitFor(t, func() bool { return checkCount(t, forceFlush, rc) >= 2 }, "both Check calls to be recorded")

	start := time.Now()
	StopServer(forceFlush, srv.GracefulStop, srv.Stop, 2*time.Second, 3*time.Second)
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = shutdown(sctx)
	if elapsed := time.Since(start); elapsed > 10*time.Second {
		t.Fatalf("stop sequence took %s, want under the 10 s grace period", elapsed)
	}

	if got := maxCheckCount(t, rc); got != 2 {
		t.Errorf("exported rpc.server.duration count for Check = %d, want 2", got)
	}
	seen := map[string]bool{}
	for _, r := range rc.find("/otlp/v1/logs") {
		var msg collogs.ExportLogsServiceRequest
		if err := proto.Unmarshal(r.body, &msg); err != nil {
			t.Fatalf("decode logs body: %v", err)
		}
		for _, rl := range msg.GetResourceLogs() {
			for _, sl := range rl.GetScopeLogs() {
				for _, rec := range sl.GetLogRecords() {
					seen[rec.GetBody().GetStringValue()] = true
				}
			}
		}
	}
	for _, want := range []string{"rec-1", "rec-2", "rec-3"} {
		if !seen[want] {
			t.Errorf("log record %q was not exported (saw %v)", want, seen)
		}
	}
}

// maxCheckCount is the largest cumulative rpc.server.duration count seen for the health Check method
// across every exported metrics request.
func maxCheckCount(t *testing.T, rc *otlpReceiver) uint64 {
	t.Helper()
	var best uint64
	for _, r := range rc.find("/otlp/v1/metrics") {
		var msg colmetrics.ExportMetricsServiceRequest
		if err := proto.Unmarshal(r.body, &msg); err != nil {
			t.Fatalf("decode metrics body: %v", err)
		}
		for _, rm := range msg.GetResourceMetrics() {
			for _, sm := range rm.GetScopeMetrics() {
				for _, m := range sm.GetMetrics() {
					if m.GetName() != "rpc.server.duration" {
						continue
					}
					for _, dp := range m.GetHistogram().GetDataPoints() {
						for _, kv := range dp.GetAttributes() {
							if kv.GetKey() == "rpc.method" && kv.GetValue().GetStringValue() == "Check" && dp.GetCount() > best {
								best = dp.GetCount()
							}
						}
					}
				}
			}
		}
	}
	return best
}

// checkCount flushes and reports the Check count seen so far, so the test waits for the deferred
// stats events instead of racing them.
func checkCount(t *testing.T, forceFlush func(context.Context) error, rc *otlpReceiver) uint64 {
	t.Helper()
	flush(t, forceFlush)
	return maxCheckCount(t, rc)
}
