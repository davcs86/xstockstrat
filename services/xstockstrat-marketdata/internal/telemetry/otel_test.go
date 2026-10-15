package telemetry

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
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

type otlpRequest struct{ method, path, auth string }

func newOTLPReceiver(t *testing.T, status int) (*httptest.Server, <-chan otlpRequest) {
	t.Helper()
	got := make(chan otlpRequest, 16)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got <- otlpRequest{r.Method, r.URL.Path, r.Header.Get("Authorization")}
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	return srv, got
}

func exportOneSpan(t *testing.T, endpoint, headers string) {
	t.Helper()
	t.Setenv("OTEL_ENABLED", "true")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint)
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", headers)
	ctx := context.Background()
	shutdown, err := Init(ctx)
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	_, span := otel.Tracer("t").Start(ctx, "s")
	span.End()
	sctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_ = shutdown(sctx)
}

// TestInitExportsOverOTLPHTTP is the feature-226 AC-1 regression: the exporter is configured only by
// the OTel spec env vars, so a path-prefixed gateway URL receives POST <path>/v1/traces with auth.
func TestInitExportsOverOTLPHTTP(t *testing.T) {
	for _, tc := range []struct{ name, headers string }{
		{"raw", "Authorization=Basic dGVzdDprZXk="},
		{"encoded", "Authorization=Basic%20dGVzdDprZXk%3D"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv, got := newOTLPReceiver(t, http.StatusOK)
			exportOneSpan(t, srv.URL+"/otlp", tc.headers)
			select {
			case req := <-got:
				if req.method != http.MethodPost || req.path != "/otlp/v1/traces" || req.auth != "Basic dGVzdDprZXk=" {
					t.Fatalf("got %+v, want POST /otlp/v1/traces with Authorization: Basic dGVzdDprZXk=", req)
				}
			default:
				t.Fatal("receiver got no export request")
			}
		})
	}
}

// TestInitLogsExportFailure is the feature-226 AC-3 regression: a rejected export is logged.
func TestInitLogsExportFailure(t *testing.T) {
	var buf bytes.Buffer
	w := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(w) })

	srv, _ := newOTLPReceiver(t, http.StatusBadRequest)
	exportOneSpan(t, srv.URL+"/otlp", "Authorization=Basic dGVzdDprZXk=")
	if !strings.Contains(buf.String(), "400 Bad Request") {
		t.Fatalf("expected a logged 400 export failure, got log: %q", buf.String())
	}
}
