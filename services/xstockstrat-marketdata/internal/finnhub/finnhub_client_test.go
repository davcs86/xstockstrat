package finnhub

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
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
	if f.Symbol != "AAPL" || f.Price != 302.25 {
		t.Fatalf("core mapping wrong: %+v", f)
	}
	if f.YearHigh != 344.5699 || f.YearLow != 223.78 || f.Beta != 1.0781745 {
		t.Fatalf("metric mapping wrong: %+v", f)
	}
	if f.PERatio != 34.7202 || f.PBRatio != 41.6339 || f.EPS != 8.7233 {
		t.Fatalf("ratio mapping wrong: %+v", f)
	}
	if f.DebtToEquity != 0.7844 {
		t.Fatalf("debt-to-equity mapping wrong: %+v", f)
	}
	// Unit conversions confirmed live this session — the load-bearing assertions.
	if got, want := f.ROE, 1.3718; !closeEnough(got, want) {
		t.Fatalf("ROE not converted percentage-points -> fraction: got %v want ~%v", got, want)
	}
	if got, want := f.DividendYield, 0.003494; !closeEnough(got, want) {
		t.Fatalf("DividendYield not converted percentage-points -> fraction: got %v want ~%v", got, want)
	}
	if got, want := f.MarketCap, 4476472.5*1_000_000; !closeEnough(got, want) {
		t.Fatalf("MarketCap not converted millions -> raw dollars: got %v want %v", got, want)
	}
	if f.Currency != "USD" {
		t.Fatalf("profile mapping wrong: %+v", f)
	}
	if f.Source != "finnhub" {
		t.Fatalf("source: got %q want finnhub", f.Source)
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
