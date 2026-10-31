package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric/noop"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	collogs "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	colmetrics "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/emptypb"
)

const (
	rawHeaders     = "Authorization=Basic dGVzdDprZXk="
	encodedHeaders = "Authorization=Basic%20dGVzdDprZXk%3D"
	wantAuth       = "Basic dGVzdDprZXk="
)

// TestNewResourceOmitsTradingMode is the feature-171 regression: the built OTel Resource must not
// carry the removed trading_mode attribute (redundant with deployment.environment) while keeping the
// service.name / deployment.environment / platform trio.
func TestNewResourceOmitsTradingMode(t *testing.T) {
	t.Setenv("APPLICATION_ENV", "staging")
	t.Setenv("TRADING_MODE", "paper")
	res, err := newResource(context.Background())
	if err != nil {
		t.Fatalf("newResource: %v", err)
	}
	got := map[string]bool{}
	for _, kv := range res.Attributes() {
		got[string(kv.Key)] = true
	}
	if got["trading_mode"] {
		t.Error("trading_mode attribute must be removed")
	}
	for _, want := range []string{"service.name", "deployment.environment", "platform"} {
		if !got[want] {
			t.Errorf("missing attribute %q", want)
		}
	}
}

type otlpRequest struct {
	method, path, auth string
	body               []byte
}

// otlpReceiver records every request it receives, with its body, and answers with a fixed status.
type otlpReceiver struct {
	srv  *httptest.Server
	mu   sync.Mutex
	reqs []otlpRequest
}

func newOTLPReceiver(t *testing.T, status int) *otlpReceiver {
	t.Helper()
	rc := &otlpReceiver{}
	rc.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		rc.mu.Lock()
		rc.reqs = append(rc.reqs, otlpRequest{r.Method, r.URL.Path, r.Header.Get("Authorization"), body})
		rc.mu.Unlock()
		w.WriteHeader(status)
	}))
	t.Cleanup(rc.srv.Close)
	return rc
}

func (rc *otlpReceiver) url() string { return rc.srv.URL + "/otlp" }

func (rc *otlpReceiver) find(path string) []otlpRequest {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	var out []otlpRequest
	for _, r := range rc.reqs {
		if r.path == path {
			out = append(out, r)
		}
	}
	return out
}

func (rc *otlpReceiver) count() int {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return len(rc.reqs)
}

// startTelemetry enables OTel against endpoint and returns Init's functions; shutdown is also
// registered as cleanup (a second shutdown is harmless).
func startTelemetry(t *testing.T, endpoint, headers string) (shutdown, forceFlush func(context.Context) error) {
	t.Helper()
	t.Setenv("OTEL_ENABLED", "true")
	t.Setenv("APPLICATION_ENV", "staging")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint)
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", headers)
	shutdown, forceFlush, err := Init(context.Background())
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = shutdown(ctx)
	})
	return shutdown, forceFlush
}

func flush(t *testing.T, forceFlush func(context.Context) error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = forceFlush(ctx)
}

func exportOneSpan(t *testing.T, endpoint, headers string) {
	t.Helper()
	shutdown, _ := startTelemetry(t, endpoint, headers)
	_, span := otel.Tracer("t").Start(context.Background(), "s")
	span.End()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = shutdown(ctx)
}

// useStdlibLogErrorHandler restores the behaviour of OTel's default error sink (the stdlib log),
// which an earlier test's WrapLogHandler may have replaced.
func useStdlibLogErrorHandler(t *testing.T) {
	t.Helper()
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) { log.Print(err) }))
}

// TestInitExportsOverOTLPHTTP is the feature-226 AC-1 regression: the exporter is configured only by
// the OTel spec env vars, so a path-prefixed gateway URL receives POST <path>/v1/traces with auth.
func TestInitExportsOverOTLPHTTP(t *testing.T) {
	for _, tc := range []struct{ name, headers string }{{"raw", rawHeaders}, {"encoded", encodedHeaders}} {
		t.Run(tc.name, func(t *testing.T) {
			rc := newOTLPReceiver(t, http.StatusOK)
			exportOneSpan(t, rc.url(), tc.headers)
			reqs := rc.find("/otlp/v1/traces")
			if len(reqs) == 0 {
				t.Fatal("receiver got no POST /otlp/v1/traces")
			}
			if reqs[0].method != http.MethodPost || reqs[0].auth != wantAuth {
				t.Fatalf("got %+v, want POST with Authorization: %s", reqs[0], wantAuth)
			}
		})
	}
}

// TestInitExportsMetricsAndLogsOverOTLPHTTP is feature 274 AC-19 (EXTEND @AC-1 @feature-226): metrics
// and logs reach the same gateway, with the same auth header, under both header forms.
func TestInitExportsMetricsAndLogsOverOTLPHTTP(t *testing.T) {
	for _, tc := range []struct{ name, headers string }{{"raw", rawHeaders}, {"encoded", encodedHeaders}} {
		t.Run(tc.name, func(t *testing.T) {
			rc := newOTLPReceiver(t, http.StatusOK)
			_, forceFlush := startTelemetry(t, rc.url(), tc.headers)

			counter, err := otel.Meter("t").Int64Counter("c")
			if err != nil {
				t.Fatalf("counter: %v", err)
			}
			counter.Add(context.Background(), 1)
			slog.New(WrapLogHandler(slog.DiscardHandler)).Info("hello")
			flush(t, forceFlush)

			for _, path := range []string{"/otlp/v1/metrics", "/otlp/v1/logs"} {
				reqs := rc.find(path)
				if len(reqs) == 0 {
					t.Fatalf("receiver got no POST %s", path)
				}
				if reqs[0].method != http.MethodPost || reqs[0].auth != wantAuth {
					t.Fatalf("%s: got %+v, want POST with Authorization: %s", path, reqs[0], wantAuth)
				}
			}
		})
	}
}

// TestExportedMetricsCarryResource is the AC-1 Go row: the exported metric request carries the
// service.name / deployment.environment / platform trio.
func TestExportedMetricsCarryResource(t *testing.T) {
	rc := newOTLPReceiver(t, http.StatusOK)
	_, forceFlush := startTelemetry(t, rc.url(), rawHeaders)
	counter, _ := otel.Meter("t").Int64Counter("c")
	counter.Add(context.Background(), 1)
	flush(t, forceFlush)

	reqs := rc.find("/otlp/v1/metrics")
	if len(reqs) == 0 {
		t.Fatal("receiver got no metrics request")
	}
	var msg colmetrics.ExportMetricsServiceRequest
	if err := proto.Unmarshal(reqs[0].body, &msg); err != nil {
		t.Fatalf("decode metrics body: %v", err)
	}
	attrs := map[string]string{}
	for _, rm := range msg.GetResourceMetrics() {
		for _, kv := range rm.GetResource().GetAttributes() {
			attrs[kv.GetKey()] = kv.GetValue().GetStringValue()
		}
	}
	for k, want := range map[string]string{"service.name": "portfolio", "deployment.environment": "staging", "platform": "xstockstrat"} {
		if attrs[k] != want {
			t.Errorf("resource attribute %s = %q, want %q (all: %v)", k, attrs[k], want, attrs)
		}
	}
	if _, ok := attrs["trading_mode"]; ok {
		t.Error("trading_mode attribute must not be exported")
	}
}

type statusVectors struct {
	BucketBoundariesMs []float64 `json:"bucket_boundaries_ms"`
}

// TestServerDurationRecordsStatusCode is AC-2: a real gRPC server wrapped by otelgrpc records
// rpc.server.duration (unit ms) with the integer status code, and the Views drop the four siblings.
func TestServerDurationRecordsStatusCode(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithView(serverMetricViews()...))

	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer(grpc.StatsHandler(otelgrpc.NewServerHandler(otelgrpc.WithMeterProvider(mp))))
	srv.RegisterService(&grpc.ServiceDesc{
		ServiceName: "t.T",
		HandlerType: (*any)(nil),
		Methods: []grpc.MethodDesc{{
			MethodName: "Get",
			Handler: func(_ any, _ context.Context, dec func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
				if err := dec(new(emptypb.Empty)); err != nil {
					return nil, err
				}
				return nil, status.Error(codes.NotFound, "nope")
			},
		}},
	}, struct{}{})
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return lis.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	err = conn.Invoke(context.Background(), "/t.T/Get", &emptypb.Empty{}, &emptypb.Empty{})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("call error = %v, want NotFound", err)
	}

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	found := false
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			switch m.Name {
			case "rpc.server.request.size", "rpc.server.response.size", "rpc.server.requests_per_rpc", "rpc.server.responses_per_rpc":
				t.Errorf("instrument %s must be dropped by serverMetricViews", m.Name)
			case "rpc.server.duration":
				found = true
				if m.Unit != "ms" {
					t.Errorf("rpc.server.duration unit = %q, want ms", m.Unit)
				}
				hist, ok := m.Data.(metricdata.Histogram[float64])
				if !ok || len(hist.DataPoints) == 0 {
					t.Fatalf("rpc.server.duration data = %T with no points", m.Data)
				}
				dp := hist.DataPoints[0]
				code, present := dp.Attributes.Value("rpc.grpc.status_code")
				if !present || code.AsInt64() != 5 {
					t.Errorf("rpc.grpc.status_code = %v (present=%v), want 5", code, present)
				}
				raw, err := os.ReadFile("../../../../scripts/testdata/rpc-status-vectors.json")
				if err != nil {
					t.Fatalf("read vectors: %v", err)
				}
				var vec statusVectors
				if err := json.Unmarshal(raw, &vec); err != nil {
					t.Fatalf("parse vectors: %v", err)
				}
				if !equalFloats(dp.Bounds, vec.BucketBoundariesMs) {
					t.Errorf("bucket bounds = %v, want %v", dp.Bounds, vec.BucketBoundariesMs)
				}
			}
		}
	}
	if !found {
		t.Fatal("rpc.server.duration was not recorded")
	}
}

func equalFloats(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestLogRecordCarriesTraceContext is AC-11 (Go row): a WARN logged with a context inside a span is
// exported with severity WARN and the span's trace_id / span_id.
func TestLogRecordCarriesTraceContext(t *testing.T) {
	rc := newOTLPReceiver(t, http.StatusOK)
	_, forceFlush := startTelemetry(t, rc.url(), rawHeaders)

	logger := slog.New(WrapLogHandler(slog.DiscardHandler))
	ctx, span := otel.Tracer("t").Start(context.Background(), "s")
	logger.WarnContext(ctx, "inside span")
	sc := span.SpanContext()
	span.End()
	flush(t, forceFlush)

	reqs := rc.find("/otlp/v1/logs")
	if len(reqs) == 0 {
		t.Fatal("receiver got no logs request")
	}
	var msg collogs.ExportLogsServiceRequest
	if err := proto.Unmarshal(reqs[0].body, &msg); err != nil {
		t.Fatalf("decode logs body: %v", err)
	}
	for _, rl := range msg.GetResourceLogs() {
		for _, sl := range rl.GetScopeLogs() {
			for _, rec := range sl.GetLogRecords() {
				if rec.GetBody().GetStringValue() != "inside span" {
					continue
				}
				if rec.GetSeverityText() != "WARN" {
					t.Errorf("severity text = %q, want WARN", rec.GetSeverityText())
				}
				tid, sid := sc.TraceID(), sc.SpanID()
				if !bytes.Equal(rec.GetTraceId(), tid[:]) || !bytes.Equal(rec.GetSpanId(), sid[:]) {
					t.Errorf("trace/span id = %x/%x, want %s/%s", rec.GetTraceId(), rec.GetSpanId(), sc.TraceID(), sc.SpanID())
				}
				return
			}
		}
	}
	t.Fatal("no log record with body \"inside span\" in the exported request")
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func waitFor(t *testing.T, cond func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

// TestInitLogsExportFailure is the feature-226 AC-3 regression: a rejected export is logged. Without
// the bridge it goes to the stdlib log; with the bridge (feature 274 AC-6) it goes to stdout only and
// never re-enters the OTLP log pipeline.
func TestInitLogsExportFailure(t *testing.T) {
	t.Run("stdlib log without the bridge", func(t *testing.T) {
		useStdlibLogErrorHandler(t)
		var buf bytes.Buffer
		w := log.Writer()
		log.SetOutput(&buf)
		t.Cleanup(func() { log.SetOutput(w) })

		rc := newOTLPReceiver(t, http.StatusBadRequest)
		exportOneSpan(t, rc.url(), rawHeaders)
		if !strings.Contains(buf.String(), "400 Bad Request") {
			t.Fatalf("expected a logged 400 export failure, got log: %q", buf.String())
		}
	})

	for _, tc := range []struct {
		name string
		want string
		// reject points the exporter at a receiver answering 400; otherwise at a closed port.
		reject bool
	}{
		{"bridge, 400 response", "400 Bad Request", true},
		{"bridge, connection refused", "connection refused", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			useStdlibLogErrorHandler(t)
			prev := slog.Default()
			t.Cleanup(func() {
				slog.SetDefault(prev)
				useStdlibLogErrorHandler(t)
			})

			rc := newOTLPReceiver(t, http.StatusBadRequest)
			endpoint := "http://127.0.0.1:1"
			if tc.reject {
				endpoint = rc.url()
			}
			stdout := &syncBuffer{}
			shutdown, _ := startTelemetry(t, endpoint, rawHeaders)
			logger := slog.New(WrapLogHandler(slog.NewJSONHandler(stdout, nil)))
			slog.SetDefault(logger)

			logger.Info("probe record")
			_, span := otel.Tracer("t").Start(context.Background(), "s")
			span.End()
			// Shutdown is the path that reports a failed batch export through the OTel error handler.
			sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = shutdown(sctx)

			t.Cleanup(func() {
				if t.Failed() {
					t.Logf("stdout was: %q", stdout.String())
				}
			})
			waitFor(t, func() bool { return strings.Contains(stdout.String(), tc.want) }, "the export failure on stdout")
			if tc.reject {
				logs := rc.find("/otlp/v1/logs")
				if len(logs) == 0 {
					t.Fatal("expected the probe record to reach /otlp/v1/logs")
				}
				for _, r := range logs {
					if bytes.Contains(r.body, []byte(tc.want)) {
						t.Errorf("an export failure was re-exported over OTLP logs: %q", tc.want)
					}
				}
			}
		})
	}
}

// TestDisabledInstallsNothing is the AC-5 analogue: with telemetry off, Init returns no-ops, installs
// no provider, WrapLogHandler returns its argument unchanged, and nothing is sent.
func TestDisabledInstallsNothing(t *testing.T) {
	rc := newOTLPReceiver(t, http.StatusOK)
	t.Setenv("OTEL_ENABLED", "false")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", rc.url())

	sentinel := noop.NewMeterProvider()
	otel.SetMeterProvider(sentinel)
	logProviderInstalled.Store(false)

	shutdown, forceFlush, err := Init(context.Background())
	if err != nil || shutdown == nil || forceFlush == nil {
		t.Fatalf("Init disabled = (%v, %v, %v), want non-nil no-op funcs and nil error", shutdown != nil, forceFlush != nil, err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Errorf("no-op shutdown: %v", err)
	}
	if err := forceFlush(context.Background()); err != nil {
		t.Errorf("no-op forceFlush: %v", err)
	}
	if otel.GetMeterProvider() != sentinel {
		t.Error("Init installed a MeterProvider while disabled")
	}
	base := slog.DiscardHandler
	if WrapLogHandler(base) != base {
		t.Error("WrapLogHandler must return its argument unchanged while disabled")
	}
	if n := rc.count(); n != 0 {
		t.Errorf("receiver saw %d requests while disabled, want 0", n)
	}
}
