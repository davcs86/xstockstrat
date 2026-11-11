package telemetry

import (
	"context"
	"net"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/test/bufconn"
)

// An outbound RPC must carry the caller's trace, or the downstream service starts a new root trace.
func TestClientStatsHandlerInjectsTraceparentWithoutClientMetrics(t *testing.T) {
	prevProp, prevTP := otel.GetTextMapPropagator(), otel.GetTracerProvider()
	t.Cleanup(func() { otel.SetTextMapPropagator(prevProp); otel.SetTracerProvider(prevTP) })
	otel.SetTextMapPropagator(propagation.TraceContext{})
	tp := sdktrace.NewTracerProvider()
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })
	otel.SetTracerProvider(tp)
	restoreMeterProvider(t)
	reader := newReaderProvider(t)

	got := make(chan string, 1)
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer(grpc.UnaryInterceptor(func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, h grpc.UnaryHandler) (any, error) {
		md, _ := metadata.FromIncomingContext(ctx)
		got <- strings.Join(md.Get("traceparent"), ",")
		return h(ctx, req)
	}))
	healthpb.RegisterHealthServer(srv, health.NewServer())
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		ClientStatsHandler(),
	)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	ctx, span := tp.Tracer("test").Start(context.Background(), "parent")
	if _, err := healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{}); err != nil {
		t.Fatalf("Check: %v", err)
	}
	span.End()

	tpHeader := <-got
	if want := span.SpanContext().TraceID().String(); !strings.Contains(tpHeader, want) {
		t.Fatalf("traceparent %q does not carry caller trace id %s", tpHeader, want)
	}
	for name := range collect(t, reader) {
		if strings.HasPrefix(name, "rpc.client.") {
			t.Errorf("unexpected client instrument %q collected", name)
		}
	}
}
