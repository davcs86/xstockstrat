package fmp

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
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
