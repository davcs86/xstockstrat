package finnhub

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xstockstrat/marketdata/internal/source"
)

// recordingRT adapts a function to http.RoundTripper and records request paths.
// Mirrors internal/fmp/fmp_client_test.go's fake verbatim (test-double scaffolding, not
// domain data — no C-13 fixture-home question applies; single consumer, this file).
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

func newTestClient(rt *recordingRT) *Client {
	return NewClient(ClientConfig{
		BaseURL:    "https://finnhub.test",
		APIKey:     "SECRET-TOKEN",
		HTTPClient: &http.Client{Transport: rt},
	})
}

// derefF reads a *float64 metric for assertions, failing loudly on an unexpected nil
// rather than silently comparing against 0. Mirrors internal/fmp/fmp_client_test.go's helper.
func derefF(t *testing.T, name string, p *float64) float64 {
	t.Helper()
	if p == nil {
		t.Fatalf("%s: expected a value, got nil", name)
	}
	return *p
}

// TestGetFundamentals_MapsField verifies field mapping across all three endpoints, using
// the exact field names and shapes confirmed live against api.finnhub.io this session
// (context.md § Step 2 session note) — including the two unit conversions the live check
// discovered: marketCapitalization (millions -> raw dollars) and roeTTM /
// currentDividendYieldTTM (percentage-points -> fraction, matching FMP's convention).
func TestGetFundamentals_MapsField(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) {
		switch path {
		case "/stock/metric":
			return 200, `{"metric":{"52WeekHigh":344.5699,"52WeekLow":223.78,"beta":1.0781745,` +
				`"peTTM":34.7202,"pb":41.6339,"epsTTM":8.7233,"roeTTM":137.18,` +
				`"totalDebt/totalEquityQuarterly":0.7844,"marketCapitalization":4476472.5,` +
				`"currentDividendYieldTTM":0.3494}}`
		case "/quote":
			return 200, `{"c":302.25,"d":-2.66,"dp":-0.8724,"h":305.66,"l":300.57,"o":305.1,"pc":304.91,"t":1786564800}`
		case "/stock/profile2":
			return 200, `{"ticker":"AAPL","currency":"USD","marketCapitalization":4411090.86}`
		}
		return 404, `{}`
	}}
	c := newTestClient(rt)

	f, err := c.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.Symbol != "AAPL" || derefF(t, "Price", f.Price) != 302.25 {
		t.Fatalf("core mapping wrong: %+v", f)
	}
	if derefF(t, "YearHigh", f.YearHigh) != 344.5699 || derefF(t, "YearLow", f.YearLow) != 223.78 ||
		derefF(t, "Beta", f.Beta) != 1.0781745 {
		t.Fatalf("metric mapping wrong: %+v", f)
	}
	if derefF(t, "PERatio", f.PERatio) != 34.7202 || derefF(t, "PBRatio", f.PBRatio) != 41.6339 ||
		derefF(t, "EPS", f.EPS) != 8.7233 {
		t.Fatalf("ratio mapping wrong: %+v", f)
	}
	if derefF(t, "DebtToEquity", f.DebtToEquity) != 0.7844 {
		t.Fatalf("debt-to-equity mapping wrong: %+v", f)
	}
	// Unit conversions confirmed live this session — the load-bearing assertions.
	if got, want := derefF(t, "ROE", f.ROE), 1.3718; !closeEnough(got, want) {
		t.Fatalf("ROE not converted percentage-points -> fraction: got %v want ~%v", got, want)
	}
	if got, want := derefF(t, "DividendYield", f.DividendYield), 0.003494; !closeEnough(got, want) {
		t.Fatalf("DividendYield not converted percentage-points -> fraction: got %v want ~%v", got, want)
	}
	if got, want := derefF(t, "MarketCap", f.MarketCap), 4476472.5*1_000_000; !closeEnough(got, want) {
		t.Fatalf("MarketCap not converted millions -> raw dollars: got %v want %v", got, want)
	}
	if f.Currency != "USD" {
		t.Fatalf("profile mapping wrong: %+v", f)
	}
	if f.Source != SourceName {
		t.Fatalf("source: got %q want %q", f.Source, SourceName)
	}
}

// TestGetFundamentals_MissingFieldStaysNil is the regression test for the null-as-zero
// bug fix: a key Finnhub omits from its JSON response — common for smaller-cap/foreign
// symbols — must decode to a nil pointer, not a false 0.0 that a screener `lte` hard
// filter would silently treat as a real, passing value.
func TestGetFundamentals_MissingFieldStaysNil(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) {
		switch path {
		case "/stock/metric":
			// "peTTM" and "currentDividendYieldTTM" omitted; "roeTTM" present as a genuine 0.
			return 200, `{"metric":{"52WeekHigh":344.5699,"52WeekLow":223.78,"beta":1.0781745,` +
				`"pb":41.6339,"epsTTM":8.7233,"roeTTM":0,` +
				`"totalDebt/totalEquityQuarterly":0.7844,"marketCapitalization":4476472.5}}`
		case "/quote":
			return 200, `{"c":302.25}`
		case "/stock/profile2":
			return 200, `{"currency":"USD"}`
		}
		return 404, `{}`
	}}
	c := newTestClient(rt)

	f, err := c.GetFundamentals(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetFundamentals: %v", err)
	}
	if f.PERatio != nil {
		t.Fatalf("PERatio: expected nil (omitted by Finnhub), got %v", *f.PERatio)
	}
	if f.DividendYield != nil {
		t.Fatalf("DividendYield: expected nil (omitted by Finnhub), got %v", *f.DividendYield)
	}
	// A genuine 0 (zero ROE) must still decode as present, not nil.
	if f.ROE == nil || *f.ROE != 0 {
		t.Fatalf("ROE: expected present value 0, got %v", f.ROE)
	}
}

func closeEnough(a, b float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d < 1e-6
}

// TestGetFundamentalsMulti_ThreeCallsPerSymbol is the regression guard for design.md's
// "no batching" finding: unlike FMP's one-quote-call core path, every Finnhub
// fundamentals endpoint takes exactly one symbol, so N symbols cost exactly 3*N calls.
// If Finnhub ever adds batching, this test forces symbols_per_minute's derivation
// (Step 1) to be re-checked rather than silently going stale.
func TestGetFundamentalsMulti_ThreeCallsPerSymbol(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) {
		switch path {
		case "/stock/metric":
			return 200, `{"metric":{"peTTM":1}}`
		case "/quote":
			return 200, `{"c":1}`
		case "/stock/profile2":
			return 200, `{"currency":"USD"}`
		}
		return 404, `{}`
	}}
	c := newTestClient(rt)

	out, err := c.GetFundamentalsMulti(context.Background(), []string{"AAPL", "MSFT", "GOOG"})
	if err != nil {
		t.Fatalf("GetFundamentalsMulti: %v", err)
	}
	if len(out) != 3 {
		t.Fatalf("expected 3 results, got %d", len(out))
	}
	for _, path := range []string{"/stock/metric", "/quote", "/stock/profile2"} {
		if got := rt.count(path); got != 3 {
			t.Fatalf("expected exactly 3 calls to %s (one per symbol, no batching), got %d", path, got)
		}
	}
}

// TestHTTPError_DoesNotLeakAPIKey mirrors fmp_client_test.go's equivalent exactly,
// substituting Finnhub's "token" param for FMP's "apikey".
func TestHTTPError_DoesNotLeakAPIKey(t *testing.T) {
	rt := &recordingRT{respond: func(path string) (int, string) { return 403, `forbidden` }}
	c := newTestClient(rt)
	_, err := c.GetFundamentals(context.Background(), "AAPL")
	if err == nil {
		t.Fatalf("expected error on HTTP 403")
	}
	if strings.Contains(err.Error(), "SECRET-TOKEN") {
		t.Fatalf("error leaked api token: %v", err)
	}
}

// TestGetFundamentals_OutageIsNotAbsence (@AC-7, @AC-8, feature 215): Finnhub has no absence signal,
// so a non-200 must surface as an outage error, never wrapped as source.ErrNoFundamentals; an empty
// 200 is a decoded row with nil fields.
func TestGetFundamentals_OutageIsNotAbsence(t *testing.T) {
	for _, status := range []int{503, 429} {
		rt := &recordingRT{respond: func(path string) (int, string) { return status, `{}` }}
		_, err := newTestClient(rt).GetFundamentals(context.Background(), "VOO")
		if err == nil {
			t.Fatalf("HTTP %d: expected an error", status)
		}
		if errors.Is(err, source.ErrNoFundamentals) {
			t.Fatalf("HTTP %d: outage wrapped as ErrNoFundamentals: %v", status, err)
		}
		if !strings.Contains(err.Error(), "/stock/metric") {
			t.Fatalf("HTTP %d: error %q does not name /stock/metric", status, err)
		}
	}

	rt := &recordingRT{respond: func(path string) (int, string) {
		if path == "/stock/metric" {
			return 200, `{"metric":{}}`
		}
		return 200, `{}`
	}}
	f, err := newTestClient(rt).GetFundamentals(context.Background(), "VOO")
	if err != nil {
		t.Fatalf("empty 200: %v", err)
	}
	if f == nil || f.Symbol != "VOO" || f.PERatio != nil || f.MarketCap != nil {
		t.Fatalf("empty 200: got %+v, want a VOO row with nil fields", f)
	}
}

// assertNoKeyLeak fails unless err names the vendor and path while carrying neither the key nor a *url.Error.
func assertNoKeyLeak(t *testing.T, err error, wantPath string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "finnhub") || !strings.Contains(msg, wantPath) {
		t.Fatalf("error %q does not name finnhub and %s", msg, wantPath)
	}
	if strings.Contains(msg, "k-secret") || strings.Contains(msg, "token=") {
		t.Fatalf("error leaked api token: %q", msg)
	}
	if errors.As(err, new(*url.Error)) {
		t.Fatalf("error chain still holds a *url.Error: %q", msg)
	}
}

func newLeakClient(baseURL string) *Client {
	return NewClient(ClientConfig{BaseURL: baseURL, APIKey: "k-secret"})
}

// Feature 254 @AC-2: a transport failure (connection refused) never reveals the API token.
func TestTransportError_DoesNotLeakAPIKey_AC2(t *testing.T) {
	_, err := newLeakClient("http://127.0.0.1:1").GetFundamentals(context.Background(), "AAPL")
	assertNoKeyLeak(t, err, "/stock/metric")
}

// Feature 254: a URL that fails to parse never reveals the API token.
func TestBuildRequestError_DoesNotLeakAPIKey(t *testing.T) {
	_, err := newLeakClient("http://127.0.0.1:1\x7f").GetFundamentals(context.Background(), "AAPL")
	assertNoKeyLeak(t, err, "/stock/metric")
}

// Feature 254: redaction keeps the deadline cause reachable via errors.Is.
func TestTransportError_PreservesDeadlineCause(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := newLeakClient(srv.URL).GetFundamentals(ctx, "AAPL")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want errors.Is(context.DeadlineExceeded)", err)
	}
	if errors.As(err, new(*url.Error)) {
		t.Fatalf("error chain still holds a *url.Error: %v", err)
	}
}
