package fmp

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// rtFunc adapts a function to http.RoundTripper and records request paths.
type recordingRT struct {
	mu    sync.Mutex
	paths []string
	// respond maps a URL path to a JSON body.
	respond func(path string) (int, string)
}

func (rt *recordingRT) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.mu.Lock()
	rt.paths = append(rt.paths, req.URL.Path)
	rt.mu.Unlock()
	status, body := rt.respond(req.URL.Path)
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}, nil
}

func (rt *recordingRT) count(path string) int {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	n := 0
	for _, p := range rt.paths {
		if p == path {
			n++
		}
	}
	return n
}

func newTestClient(metrics []string, rt *recordingRT) *Client {
	return NewClient(ClientConfig{
		BaseURL:    "https://fmp.test",
		APIKey:     "SECRET-KEY",
		Metrics:    metrics,
		HTTPClient: &http.Client{Transport: rt},
	})
}

// derefF reads a *float64 metric for assertions, failing loudly on an unexpected nil
// rather than silently comparing against 0.
func derefF(t *testing.T, name string, p *float64) float64 {
	t.Helper()
	if p == nil {
		t.Fatalf("%s: expected a value, got nil", name)
	}
	return *p
}

// TestGetFundamentals_MapsCoreAndExtended verifies field mapping across all three endpoints.
func TestGetFundamentals_MapsCoreAndExtended(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) {
		switch path {
		case "/stable/quote":
			return 200, `[{"symbol":"AAPL","price":150.5,"marketCap":2.5e12,"pe":25.0,"eps":6.0,"yearHigh":180,"yearLow":120,"volume":1000}]`
		case "/stable/ratios-ttm":
			return 200, `[{"priceToBookRatioTTM":40.0,"dividendYieldTTM":0.005,"returnOnEquityTTM":1.5,"debtToEquityRatioTTM":1.2}]`
		case "/stable/profile":
			return 200, `[{"beta":1.3,"currency":"USD"}]`
		}
		return 404, `[]`
	}}
	c := newTestClient([]string{"core", "extended"}, rt)

	f, err := c.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.Symbol != "AAPL" || derefF(t, "Price", f.Price) != 150.5 || derefF(t, "MarketCap", f.MarketCap) != 2.5e12 ||
		derefF(t, "PERatio", f.PERatio) != 25.0 || derefF(t, "EPS", f.EPS) != 6.0 {
		t.Fatalf("core mapping wrong: %+v", f)
	}
	if derefF(t, "PBRatio", f.PBRatio) != 40.0 || derefF(t, "DividendYield", f.DividendYield) != 0.005 ||
		derefF(t, "ROE", f.ROE) != 1.5 || derefF(t, "DebtToEquity", f.DebtToEquity) != 1.2 {
		t.Fatalf("extended ratios mapping wrong: %+v", f)
	}
	if derefF(t, "Beta", f.Beta) != 1.3 || f.Currency != "USD" {
		t.Fatalf("profile mapping wrong: %+v", f)
	}
	if f.ExtraMetrics["volume"] != 1000 {
		t.Fatalf("extra_metrics not populated: %+v", f.ExtraMetrics)
	}
	if f.Source != "fmp" {
		t.Fatalf("source: got %q want fmp", f.Source)
	}
}

// TestGetFundamentals_MissingFieldStaysNil is the regression test for the null-as-zero
// bug fix: a key FMP omits from its JSON response (here, "pe" and "dividendYieldTTM")
// must decode to a nil pointer, not a false 0.0 that a screener `lte` hard filter would
// silently treat as a real, passing value.
func TestGetFundamentals_MissingFieldStaysNil(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) {
		switch path {
		case "/stable/quote":
			// "pe" omitted entirely.
			return 200, `[{"symbol":"AAPL","price":150.5,"marketCap":2.5e12,"eps":6.0}]`
		case "/stable/ratios-ttm":
			// "dividendYieldTTM" omitted; the others present (including a genuine 0).
			return 200, `[{"priceToBookRatioTTM":40.0,"returnOnEquityTTM":0,"debtToEquityRatioTTM":1.2}]`
		case "/stable/profile":
			return 200, `[{"beta":1.3,"currency":"USD"}]`
		}
		return 404, `[]`
	}}
	c := newTestClient([]string{"core", "extended"}, rt)

	f, err := c.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.PERatio != nil {
		t.Fatalf("PERatio: expected nil (omitted by FMP), got %v", *f.PERatio)
	}
	if f.DividendYield != nil {
		t.Fatalf("DividendYield: expected nil (omitted by FMP), got %v", *f.DividendYield)
	}
	// A genuine 0 (zero ROE) must still decode as present, not nil.
	if f.ROE == nil || *f.ROE != 0 {
		t.Fatalf("ROE: expected present value 0, got %v", f.ROE)
	}
}

// TestGetFundamentalsMulti_OneQuoteCall verifies core metrics for N symbols cost exactly
// one quote request (acceptance #5).
func TestGetFundamentalsMulti_OneQuoteCall(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) {
		if path == "/stable/quote" {
			return 200, `[{"symbol":"AAPL","price":1},{"symbol":"MSFT","price":2},{"symbol":"GOOG","price":3}]`
		}
		return 200, `[]`
	}}
	c := newTestClient([]string{"core"}, rt) // core-only: no ratios/profile calls

	out, err := c.GetFundamentalsMulti(context.Background(), []string{"AAPL", "MSFT", "GOOG"})
	if err != nil {
		t.Fatalf("GetFundamentalsMulti: %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("expected 3 results, got %d", len(out))
	}
	if got := rt.count("/stable/quote"); got != 1 {
		t.Fatalf("expected exactly 1 quote call, got %d", got)
	}
	if got := rt.count("/stable/ratios-ttm"); got != 0 {
		t.Fatalf("core-only should not call ratios-ttm, got %d", got)
	}
	// Order preserved.
	if out[0].Symbol != "AAPL" || out[1].Symbol != "MSFT" || out[2].Symbol != "GOOG" {
		t.Fatalf("order not preserved: %v %v %v", out[0].Symbol, out[1].Symbol, out[2].Symbol)
	}
}

// The boot quota seed counts rows by source with as_of >= today, so AsOf must be the fetch instant.
func TestToFundamentals_SourceAndAsOfIsFetchInstant(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) {
		if path == "/stable/quote" {
			return 200, `[{"symbol":"AAPL","price":1}]`
		}
		return 200, `[]`
	}}
	c := newTestClient([]string{"core"}, rt)

	f, err := c.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.Source != SourceName {
		t.Fatalf("source: got %q want %q", f.Source, SourceName)
	}
	if age := time.Since(f.AsOf); age < 0 || age >= 5*time.Second {
		t.Fatalf("AsOf = %v (age %v), want the fetch instant", f.AsOf, age)
	}
}

// TestHTTPError_DoesNotLeakAPIKey ensures error strings never contain the API key.
func TestHTTPError_DoesNotLeakAPIKey(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) { return 403, `forbidden` }}
	c := newTestClient([]string{"core"}, rt)
	_, err := c.GetFundamentals(context.Background(), "AAPL")
	if err == nil {
		t.Fatalf("expected error on HTTP 403")
	}
	if strings.Contains(err.Error(), "SECRET-KEY") {
		t.Fatalf("error leaked api key: %v", err)
	}
}

// Feature 215: an empty /stable/quote result is vendor absence, so GetFundamentals wraps
// source.ErrNoFundamentals (marketdata maps it to NotFound, never an outage).
func TestGetFundamentals_EmptyQuoteIsNoFundamentals(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) { return 200, `[]` }}
	c := newTestClient([]string{"core"}, rt)
	_, err := c.GetFundamentals(context.Background(), "VOO")
	if !errors.Is(err, source.ErrNoFundamentals) {
		t.Fatalf("err = %v, want errors.Is(source.ErrNoFundamentals)", err)
	}
}

// assertNoKeyLeak fails unless err names the vendor and path while carrying neither the key nor a *url.Error.
func assertNoKeyLeak(t *testing.T, err error, wantPath string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "fmp") || !strings.Contains(msg, wantPath) {
		t.Fatalf("error %q does not name fmp and %s", msg, wantPath)
	}
	if strings.Contains(msg, "k-secret") || strings.Contains(msg, "apikey=") {
		t.Fatalf("error leaked api key: %q", msg)
	}
	if errors.As(err, new(*url.Error)) {
		t.Fatalf("error chain still holds a *url.Error: %q", msg)
	}
}

func newLeakClient(baseURL string) *Client {
	return NewClient(ClientConfig{BaseURL: baseURL, APIKey: "k-secret", Metrics: []string{"core"}})
}

// Feature 254 @AC-1: a transport failure (connection refused) never reveals the API key.
func TestTransportError_DoesNotLeakAPIKey_AC1(t *testing.T) {
	c := newLeakClient("http://127.0.0.1:1")
	_, err := c.GetFundamentalsMulti(context.Background(), []string{"AAPL"})
	assertNoKeyLeak(t, err, "/stable/quote")
	_, err = c.FetchSector(context.Background(), "AAPL")
	assertNoKeyLeak(t, err, "/stable/profile")
}

// Feature 254: a URL that fails to parse never reveals the API key.
func TestBuildRequestError_DoesNotLeakAPIKey(t *testing.T) {
	c := newLeakClient("http://127.0.0.1:1\x7f")
	_, err := c.GetFundamentalsMulti(context.Background(), []string{"AAPL"})
	assertNoKeyLeak(t, err, "/stable/quote")
}

// Feature 254: redaction keeps the deadline cause reachable via errors.Is.
func TestTransportError_PreservesDeadlineCause(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := newLeakClient(srv.URL).GetFundamentalsMulti(ctx, []string{"AAPL"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want errors.Is(context.DeadlineExceeded)", err)
	}
	if errors.As(err, new(*url.Error)) {
		t.Fatalf("error chain still holds a *url.Error: %v", err)
	}
}

// captureSlog routes the default logger into a buffer for the test and restores it after.
func captureSlog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func enrichmentWarns(log string) int {
	return strings.Count(log, `level=WARN msg="fmp enrichment failed"`)
}

// enrichBodies serves 200 quote and ratios bodies and the given profile response.
func enrichBodies(profileStatus int, profileBody string) func(string) (int, string) {
	return func(path string) (int, string) {
		switch path {
		case "/stable/quote":
			return 200, `[{"symbol":"AAPL","price":150}]`
		case "/stable/ratios-ttm":
			return 200, `[{"priceToBookRatioTTM":40.0}]`
		}
		return profileStatus, profileBody
	}
}

// profileRT delegates quote/ratios to enrichBodies and hands the profile request to profile.
type profileRT struct {
	recordingRT
	profile func(req *http.Request) (*http.Response, error)
}

func (rt *profileRT) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Path == "/stable/profile" {
		return rt.profile(req)
	}
	return rt.recordingRT.RoundTrip(req)
}

func newProfileClient(profile func(*http.Request) (*http.Response, error)) *Client {
	rt := &profileRT{recordingRT: recordingRT{respond: enrichBodies(200, `[]`)}, profile: profile}
	return NewClient(ClientConfig{BaseURL: "https://fmp.test", APIKey: "SECRET-KEY",
		Metrics: []string{"core", "extended"}, HTTPClient: &http.Client{Transport: rt}})
}

type failingBody struct{}

func (failingBody) Read([]byte) (int, error) { return 0, errors.New("body read failed") }
func (failingBody) Close() error             { return nil }

// @AC-10 (client half): a transient profile 503 flags the row; the ratios metrics still apply.
func TestEnrichment_Profile503_FlagsTransient_AC10(t *testing.T) {
	logBuf := captureSlog(t)
	rt := &recordingRT{respond: enrichBodies(503, ``)}
	f, err := newTestClient([]string{"core", "extended"}, rt).GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if !f.EnrichmentFailed {
		t.Fatal("EnrichmentFailed = false, want true on a profile 503")
	}
	if f.Beta != nil {
		t.Fatalf("Beta = %v, want nil", *f.Beta)
	}
	if got := derefF(t, "PBRatio", f.PBRatio); got != 40.0 {
		t.Fatalf("PBRatio = %v, want 40 (ratios applied)", got)
	}
	log := logBuf.String()
	if enrichmentWarns(log) != 1 || !strings.Contains(log, "AAPL:profile:http_503") {
		t.Fatalf("want one WARN carrying AAPL:profile:http_503, got:\n%s", log)
	}
}

// Deterministic 402/403/404 keep the row fresh but are still reported in the WARN.
func TestEnrichment_Deterministic4xxNotFlagged(t *testing.T) {
	for _, tc := range []struct {
		name, failPath, pair string
		code                 int
	}{
		{"profile 404", "/stable/profile", "AAPL:profile:http_404", 404},
		{"ratios 402", "/stable/ratios-ttm", "AAPL:ratios:http_402", 402},
		// The 403 exemption is the design's Open Risk, operator-sanctioned (r3 (2)).
		{"profile 403", "/stable/profile", "AAPL:profile:http_403", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logBuf := captureSlog(t)
			rt := &recordingRT{respond: func(path string) (int, string) {
				switch path {
				case tc.failPath:
					return tc.code, `{"error":"plan"}`
				case "/stable/quote":
					return 200, `[{"symbol":"AAPL","price":150}]`
				case "/stable/ratios-ttm":
					return 200, `[{"priceToBookRatioTTM":40.0}]`
				}
				return 200, `[{"beta":1.3}]`
			}}
			f, err := newTestClient([]string{"core", "extended"}, rt).GetFundamentals(context.Background(), "AAPL")
			if err != nil {
				t.Fatalf("GetFundamentals: %v", err)
			}
			if f.EnrichmentFailed {
				t.Fatalf("EnrichmentFailed = true, want false on HTTP %d", tc.code)
			}
			if tc.failPath == "/stable/profile" && f.Beta != nil {
				t.Fatalf("Beta = %v, want nil", *f.Beta)
			}
			if tc.failPath == "/stable/ratios-ttm" && f.PBRatio != nil {
				t.Fatalf("PBRatio = %v, want nil", *f.PBRatio)
			}
			log := logBuf.String()
			if enrichmentWarns(log) != 1 || !strings.Contains(log, tc.pair) {
				t.Fatalf("want one WARN carrying %s, got:\n%s", tc.pair, log)
			}
		})
	}
}

// Every non-exempt failure class flags the row and is labelled in the single WARN (cap: the AC-5 gateway test).
func TestEnrichment_FailureClassesFlagRow(t *testing.T) {
	status := func(code int, body string) func(*http.Request) (*http.Response, error) {
		return func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		}
	}
	for _, tc := range []struct {
		class   string
		profile func(*http.Request) (*http.Response, error)
	}{
		{"http_500", status(500, ``)},
		// 400, 401 and 429 are unassigned codes, so they expire (Open Risk, acknowledged with r4).
		{"http_400", status(400, ``)},
		{"http_401", status(401, ``)},
		{"http_429", status(429, ``)},
		{"transport", func(*http.Request) (*http.Response, error) { return nil, errors.New("connection reset") }},
		{"read", func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: failingBody{}, Header: make(http.Header)}, nil
		}},
		{"decode", status(200, `[{`)},
		{"ctx", nil},
	} {
		t.Run(tc.class, func(t *testing.T) {
			logBuf := captureSlog(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			profile := tc.profile
			if profile == nil {
				profile = func(*http.Request) (*http.Response, error) { cancel(); return nil, context.Canceled }
			}
			f, err := newProfileClient(profile).GetFundamentals(ctx, "AAPL")
			if err != nil {
				t.Fatalf("GetFundamentals: %v", err)
			}
			if !f.EnrichmentFailed {
				t.Fatalf("EnrichmentFailed = false, want true for class %s", tc.class)
			}
			if f.Beta != nil {
				t.Fatalf("Beta = %v, want nil", *f.Beta)
			}
			log := logBuf.String()
			if want := "AAPL:profile:" + tc.class; enrichmentWarns(log) != 1 || !strings.Contains(log, want) {
				t.Fatalf("want one WARN carrying %s, got:\n%s", want, log)
			}
		})
	}
}

// Both transport return sites (url.Error inner cause and un-wrapped) and unstaged errors classify without string matching.
func TestEnrichmentClassifier_StagesAndOther(t *testing.T) {
	for _, tc := range []struct {
		name    string
		err     error
		class   string
		expires bool
	}{
		{"transport cause", &stageError{"transport", fmt.Errorf("fmp: p request failed: %w", errors.New("reset"))}, "transport", true},
		{"transport un-wrapped", &stageError{"transport", errors.New("fmp: p request failed")}, "transport", true},
		{"transport deadline", &stageError{"transport", fmt.Errorf("fmp: p request failed: %w", context.DeadlineExceeded)}, "ctx", true},
		{"build request", errors.New("fmp: p build request"), "other", true},
		{"cap", ErrFMPDailyCapExceeded, "cap", true},
		{"http 404", &statusError{"/stable/profile", 404}, "http_404", false},
	} {
		if got := enrichmentClass(tc.err); got != tc.class {
			t.Errorf("%s: class = %q, want %q", tc.name, got, tc.class)
		}
		if got := ErrorClass(tc.err); got != tc.class || got == "" {
			t.Errorf("%s: ErrorClass = %q, want %q (never empty, AC-5)", tc.name, got, tc.class)
		}
		if got := enrichmentExpires(tc.err); got != tc.expires {
			t.Errorf("%s: expires = %v, want %v", tc.name, got, tc.expires)
		}
	}
	if enrichmentExpires(nil) {
		t.Error("enrichmentExpires(nil) = true, want false")
	}
}

// The enrichment WARN never carries the API key, even when the transport error text holds the URL.
func TestEnrichment_WarnDoesNotLeakAPIKey(t *testing.T) {
	logBuf := captureSlog(t)
	c := newProfileClient(func(req *http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("dial failed for %s", req.URL.String())
	})
	if _, err := c.GetFundamentals(context.Background(), "AAPL"); err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	log := logBuf.String()
	if !strings.Contains(log, "AAPL:profile:transport") {
		t.Fatalf("WARN missing AAPL:profile:transport:\n%s", log)
	}
	if strings.Contains(log, "SECRET-KEY") || strings.Contains(log, "apikey") {
		t.Fatalf("WARN leaked the api key:\n%s", log)
	}
}

// An empty profile array is vendor absence, not a failure: no flag and no WARN.
func TestEnrichment_EmptyProfileIsNotAFailure(t *testing.T) {
	logBuf := captureSlog(t)
	rt := &recordingRT{respond: enrichBodies(200, `[]`)}
	f, err := newTestClient([]string{"core", "extended"}, rt).GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.EnrichmentFailed {
		t.Fatal("EnrichmentFailed = true, want false on an empty profile")
	}
	if n := enrichmentWarns(logBuf.String()); n != 0 {
		t.Fatalf("enrichment WARNs = %d, want 0:\n%s", n, logBuf.String())
	}
}

// statusError text stays URL-free so TestHTTPError_DoesNotLeakAPIKey keeps holding.
func TestStatusError_TextIsPathAndCode(t *testing.T) {
	got := (&statusError{path: "/stable/profile", code: 503}).Error()
	if want := "fmp: /stable/profile returned HTTP 503"; got != want {
		t.Fatalf("statusError text = %q, want %q", got, want)
	}
}
