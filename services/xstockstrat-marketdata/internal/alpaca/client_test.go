package alpaca_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"golang.org/x/time/rate"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	"github.com/xstockstrat/marketdata/internal/alpaca"
)

func makeTestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(handler)
}

func TestGetBars_Success(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("APCA-API-KEY-ID") == "" {
			t.Error("expected APCA-API-KEY-ID header")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"bars": []map[string]interface{}{
				{
					"t":  "2024-01-02T10:00:00Z",
					"o":  100.0,
					"h":  105.0,
					"l":  99.0,
					"c":  102.0,
					"v":  int64(5000),
					"vw": 101.5,
					"n":  int32(200),
				},
				{
					"t":  "2024-01-02T11:00:00Z",
					"o":  102.0,
					"h":  107.0,
					"l":  101.0,
					"c":  106.0,
					"v":  int64(3000),
					"vw": 104.0,
					"n":  int32(150),
				},
			},
			"symbol":          "AAPL",
			"next_page_token": "",
		})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:    "test-key",
		APISecret: "test-secret",
		DataURL:   srv.URL,
	})

	start := time.Date(2024, 1, 2, 9, 0, 0, 0, time.UTC)
	end := time.Date(2024, 1, 2, 16, 0, 0, 0, time.UTC)
	bars, err := c.GetBars(context.Background(), "AAPL", "1Hour", start, end)
	if err != nil {
		t.Fatalf("GetBars failed: %v", err)
	}
	if len(bars) != 2 {
		t.Errorf("expected 2 bars, got %d", len(bars))
	}
	if bars[0].Symbol != "AAPL" {
		t.Errorf("expected symbol AAPL, got %s", bars[0].Symbol)
	}
	if bars[0].Open != 100.0 {
		t.Errorf("expected open 100.0, got %f", bars[0].Open)
	}
}

func TestGetBars_HTTPError(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"Forbidden"}`))
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:    "bad-key",
		APISecret: "bad-secret",
		DataURL:   srv.URL,
	})

	_, err := c.GetBars(context.Background(), "AAPL", "1Hour",
		time.Now().Add(-time.Hour), time.Now())
	if err == nil {
		t.Fatal("expected error for 401 response, got nil")
	}
}

func TestGetBars_Pagination(t *testing.T) {
	callCount := 0
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		if callCount == 1 {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"bars": []map[string]interface{}{
					{"t": "2024-01-02T09:00:00Z", "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.5, "v": int64(1000), "vw": 100.2, "n": int32(50)},
				},
				"symbol":          "TSLA",
				"next_page_token": "page2token",
			})
		} else {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"bars": []map[string]interface{}{
					{"t": "2024-01-02T10:00:00Z", "o": 100.5, "h": 102.0, "l": 100.0, "c": 101.5, "v": int64(2000), "vw": 101.0, "n": int32(80)},
				},
				"symbol":          "TSLA",
				"next_page_token": "",
			})
		}
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:  "k",
		DataURL: srv.URL,
	})

	bars, err := c.GetBars(context.Background(), "TSLA", "1Hour",
		time.Now().Add(-2*time.Hour), time.Now())
	if err != nil {
		t.Fatalf("GetBars (pagination) failed: %v", err)
	}
	if len(bars) != 2 {
		t.Errorf("expected 2 bars across pages, got %d", len(bars))
	}
	if callCount != 2 {
		t.Errorf("expected 2 HTTP calls for pagination, got %d", callCount)
	}
}

func TestGetLatestQuote_Success(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"quote": map[string]interface{}{
				"t":  "2024-01-02T10:00:00Z",
				"ap": 150.25,
				"as": int32(100),
				"bp": 150.20,
				"bs": int32(200),
			},
		})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:  "test-key",
		DataURL: srv.URL,
	})

	quote, err := c.GetLatestQuote(context.Background(), "AAPL")
	if err != nil {
		t.Fatalf("GetLatestQuote failed: %v", err)
	}
	if quote.Symbol != "AAPL" {
		t.Errorf("expected symbol AAPL, got %s", quote.Symbol)
	}
	if quote.AskPrice != 150.25 {
		t.Errorf("expected ask 150.25, got %f", quote.AskPrice)
	}
	if quote.BidPrice != 150.20 {
		t.Errorf("expected bid 150.20, got %f", quote.BidPrice)
	}
}

func TestGetLatestQuote_HTTPError(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"symbol not found"}`))
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:  "k",
		DataURL: srv.URL,
	})

	_, err := c.GetLatestQuote(context.Background(), "UNKNOWN")
	if err == nil {
		t.Fatal("expected error for 404 response, got nil")
	}
}

func TestNewClient_DefaultHTTPTimeout(t *testing.T) {
	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:    "k",
		APISecret: "s",
		DataURL:   "https://data.alpaca.markets",
	})
	if c == nil {
		t.Fatal("expected non-nil client")
	}
}

func TestListAssets_Success(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/assets" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]interface{}{
			{"symbol": "AAPL", "exchange": "NASDAQ", "class": "us_equity", "tradable": true},
			{"symbol": "SKIP", "exchange": "NYSE", "class": "us_equity", "tradable": false},
			{"symbol": "MSFT", "exchange": "NASDAQ", "class": "us_equity", "tradable": true},
		})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:  "k",
		BaseURL: srv.URL,
	})

	assets, err := c.ListAssets(context.Background(), "")
	if err != nil {
		t.Fatalf("ListAssets failed: %v", err)
	}
	if len(assets) != 2 {
		t.Errorf("expected 2 tradable assets, got %d", len(assets))
	}
	if assets[0].Symbol != "AAPL" {
		t.Errorf("expected first asset AAPL, got %s", assets[0].Symbol)
	}
}

func TestListAssets_WithAssetClass(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("asset_class") != "crypto" {
			t.Errorf("expected asset_class=crypto, got %q", r.URL.Query().Get("asset_class"))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]interface{}{
			{"symbol": "BTCUSD", "exchange": "CBSE", "class": "crypto", "tradable": true},
		})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:  "k",
		BaseURL: srv.URL,
	})

	assets, err := c.ListAssets(context.Background(), "crypto")
	if err != nil {
		t.Fatalf("ListAssets with class failed: %v", err)
	}
	if len(assets) != 1 || assets[0].Symbol != "BTCUSD" {
		t.Errorf("unexpected assets: %+v", assets)
	}
}

func TestListAssets_HTTPError(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message":"forbidden"}`))
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{
		APIKey:  "bad",
		BaseURL: srv.URL,
	})

	_, err := c.ListAssets(context.Background(), "")
	if err == nil {
		t.Fatal("expected error for 403 response, got nil")
	}
}

func TestGetLatestQuote_DefaultFeedIEX(t *testing.T) {
	var gotFeed string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotFeed = r.URL.Query().Get("feed")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"quote": map[string]interface{}{"t": "2024-01-02T10:00:00Z", "ap": 1.0, "bp": 1.0},
		})
	})
	defer srv.Close()

	// No Feed configured → defaults to "iex" (free/paper data plan).
	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL})
	if _, err := c.GetLatestQuote(context.Background(), "AAPL"); err != nil {
		t.Fatalf("GetLatestQuote failed: %v", err)
	}
	if gotFeed != "iex" {
		t.Errorf("expected feed=iex by default, got %q", gotFeed)
	}
}

func TestGetLatestQuote_ConfiguredFeed(t *testing.T) {
	var gotFeed string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotFeed = r.URL.Query().Get("feed")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"quote": map[string]interface{}{"t": "2024-01-02T10:00:00Z", "ap": 1.0, "bp": 1.0},
		})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL, Feed: "sip"})
	if _, err := c.GetLatestQuote(context.Background(), "AAPL"); err != nil {
		t.Fatalf("GetLatestQuote failed: %v", err)
	}
	if gotFeed != "sip" {
		t.Errorf("expected feed=sip, got %q", gotFeed)
	}
}

func TestGetBars_TranslatesCanonicalTimeframe(t *testing.T) {
	// The always-on bar ingester and DB-miss fallback pass the canonical interval
	// strings (1m/5m/1h/1d). Alpaca rejects those with 400 "invalid timeframe: 1m" —
	// they must be translated to 1Min/5Min/1Hour/1Day on the outbound request, while
	// the stored bar keeps the canonical form callers query against.
	cases := []struct {
		in       string
		want     string
		wantEnum commonv1.Timeframe
	}{
		{"15m", "15Min", commonv1.Timeframe_TIMEFRAME_15MIN}, //nolint:staticcheck // SA1019: deprecated for requests (feature 143) but still resolved for historical rows
		{"1h", "1Hour", commonv1.Timeframe_TIMEFRAME_1HOUR},  //nolint:staticcheck // SA1019: deprecated for requests (feature 143) but still resolved for historical rows
		{"1d", "1Day", commonv1.Timeframe_TIMEFRAME_1DAY},
		{"15Min", "15Min", commonv1.Timeframe_TIMEFRAME_15MIN}, //nolint:staticcheck // SA1019: already-Alpaca form passes through; deprecated for requests (feature 143) but still resolved for historical rows
		{"1Hour", "1Hour", commonv1.Timeframe_TIMEFRAME_1HOUR}, //nolint:staticcheck // SA1019: already-Alpaca form passes through; deprecated for requests (feature 143) but still resolved for historical rows
		{"1Day", "1Day", commonv1.Timeframe_TIMEFRAME_1DAY},    // feature 080: no 1Day input row existed before
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			var gotTF string
			srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
				gotTF = r.URL.Query().Get("timeframe")
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"bars": []map[string]interface{}{
						{"t": "2024-01-02T10:00:00Z", "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": int64(1), "vw": 1.0, "n": int32(1)},
					},
					"next_page_token": "",
				})
			})
			defer srv.Close()

			c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL})
			bars, err := c.GetBars(context.Background(), "AAPL", tc.in, time.Now().Add(-time.Hour), time.Now())
			if err != nil {
				t.Fatalf("GetBars failed: %v", err)
			}
			if gotTF != tc.want {
				t.Errorf("timeframe %q: expected outbound timeframe=%q, got %q", tc.in, tc.want, gotTF)
			}
			// Stored bars keep the caller's (canonical) timeframe, not the Alpaca spelling.
			if len(bars) != 1 || bars[0].Timeframe != tc.in { //nolint:staticcheck // SA1019: asserting the deprecated string timeframe field is preserved on the stored bar
				t.Errorf("timeframe %q: expected stored bar timeframe=%q, got %+v", tc.in, tc.in, bars)
			}
			// feature 080 AC-6: the replacement field is paired with the deprecated string,
			// not derived by calling the mapper under test — a hardcoded expectation.
			if len(bars) == 1 && bars[0].TimeframeEnum != tc.wantEnum {
				t.Errorf("timeframe %q: expected TimeframeEnum=%v, got %v", tc.in, tc.wantEnum, bars[0].TimeframeEnum)
			}
		})
	}
}

func TestGetBars_SendsFeed(t *testing.T) {
	var gotFeed string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotFeed = r.URL.Query().Get("feed")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"bars": []interface{}{}, "next_page_token": ""})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL})
	if _, err := c.GetBars(context.Background(), "AAPL", "1Day", time.Now().Add(-24*time.Hour), time.Now()); err != nil {
		t.Fatalf("GetBars failed: %v", err)
	}
	if gotFeed != "iex" {
		t.Errorf("expected feed=iex on bars request, got %q", gotFeed)
	}
}

func TestGetBars_DefaultAdjustmentAllAndMaxLimit(t *testing.T) {
	var gotAdjustment, gotLimit string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotAdjustment = r.URL.Query().Get("adjustment")
		gotLimit = r.URL.Query().Get("limit")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"bars": []interface{}{}, "next_page_token": ""})
	})
	defer srv.Close()

	// No Adjustment/BatchSize configured → adjustment=all and limit=10000 (spec max).
	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL})
	if _, err := c.GetBars(context.Background(), "AAPL", "1Day", time.Now().Add(-24*time.Hour), time.Now()); err != nil {
		t.Fatalf("GetBars failed: %v", err)
	}
	if gotAdjustment != "all" {
		t.Errorf("expected adjustment=all by default, got %q", gotAdjustment)
	}
	if gotLimit != "10000" {
		t.Errorf("expected limit=10000 by default, got %q", gotLimit)
	}
}

func TestGetBars_ConfiguredAdjustmentAndBatchSize(t *testing.T) {
	var gotAdjustment, gotLimit string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotAdjustment = r.URL.Query().Get("adjustment")
		gotLimit = r.URL.Query().Get("limit")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"bars": []interface{}{}, "next_page_token": ""})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL, Adjustment: "split", BatchSize: 500})
	if _, err := c.GetBars(context.Background(), "AAPL", "1Day", time.Now().Add(-24*time.Hour), time.Now()); err != nil {
		t.Fatalf("GetBars failed: %v", err)
	}
	if gotAdjustment != "split" {
		t.Errorf("expected adjustment=split, got %q", gotAdjustment)
	}
	if gotLimit != "500" {
		t.Errorf("expected limit=500, got %q", gotLimit)
	}
}

func TestGetBars_BatchSizeClampedToMax(t *testing.T) {
	var gotLimit string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotLimit = r.URL.Query().Get("limit")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"bars": []interface{}{}, "next_page_token": ""})
	})
	defer srv.Close()

	// A batch size above the spec maximum is clamped to 10000.
	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL, BatchSize: 999999})
	if _, err := c.GetBars(context.Background(), "AAPL", "1Day", time.Now().Add(-24*time.Hour), time.Now()); err != nil {
		t.Fatalf("GetBars failed: %v", err)
	}
	if gotLimit != "10000" {
		t.Errorf("expected limit clamped to 10000, got %q", gotLimit)
	}
}

func TestGetBarsMulti_Success(t *testing.T) {
	var gotSymbols string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/stocks/bars" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		gotSymbols = r.URL.Query().Get("symbols")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"bars": map[string]interface{}{
				"AAPL": []map[string]interface{}{
					{"t": "2024-01-02T10:00:00Z", "o": 100.0, "h": 105.0, "l": 99.0, "c": 102.0, "v": int64(5000), "vw": 101.5, "n": int32(200)},
				},
				"MSFT": []map[string]interface{}{
					{"t": "2024-01-02T10:00:00Z", "o": 400.0, "h": 405.0, "l": 399.0, "c": 402.0, "v": int64(3000), "vw": 401.5, "n": int32(120)},
				},
			},
			"next_page_token": "",
		})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL})
	out, err := c.GetBarsMulti(context.Background(), []string{"AAPL", "MSFT"}, "1Day",
		time.Now().Add(-24*time.Hour), time.Now())
	if err != nil {
		t.Fatalf("GetBarsMulti failed: %v", err)
	}
	if gotSymbols != "AAPL,MSFT" {
		t.Errorf("expected symbols=AAPL,MSFT, got %q", gotSymbols)
	}
	// feature 080 AC-6: GetBarsMulti is a direct assertion, not "the shared helper covers it".
	if len(out["AAPL"]) != 1 || out["AAPL"][0].Timeframe != "1Day" || out["AAPL"][0].TimeframeEnum != commonv1.Timeframe_TIMEFRAME_1DAY { //nolint:staticcheck // SA1019: asserting the deprecated string timeframe field is preserved on the stored bar
		t.Errorf("expected AAPL bar timeframe=1Day/TIMEFRAME_1DAY, got %+v", out["AAPL"])
	}
	if len(out["AAPL"]) != 1 || out["AAPL"][0].Close != 102.0 {
		t.Errorf("unexpected AAPL bars: %+v", out["AAPL"])
	}
	if len(out["MSFT"]) != 1 || out["MSFT"][0].Open != 400.0 {
		t.Errorf("unexpected MSFT bars: %+v", out["MSFT"])
	}
}

func TestGetLatestQuotesMulti_Success(t *testing.T) {
	var gotSymbols string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/stocks/quotes/latest" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		gotSymbols = r.URL.Query().Get("symbols")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"quotes": map[string]interface{}{
				"AAPL": map[string]interface{}{"t": "2024-01-02T10:00:00Z", "ap": 150.25, "as": int32(100), "bp": 150.20, "bs": int32(200)},
				"MSFT": map[string]interface{}{"t": "2024-01-02T10:00:00Z", "ap": 400.10, "as": int32(50), "bp": 400.00, "bs": int32(60)},
			},
		})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL})
	out, err := c.GetLatestQuotesMulti(context.Background(), []string{"AAPL", "MSFT"})
	if err != nil {
		t.Fatalf("GetLatestQuotesMulti failed: %v", err)
	}
	if gotSymbols != "AAPL,MSFT" {
		t.Errorf("expected symbols=AAPL,MSFT, got %q", gotSymbols)
	}
	if out["AAPL"].AskPrice != 150.25 || out["MSFT"].BidPrice != 400.00 {
		t.Errorf("unexpected quotes: %+v", out)
	}
}

// feature 095 — GetLatestTrade parses the latest-trade price + timestamp from Alpaca's
// /v2/stocks/{sym}/trades/latest endpoint (single inline body literal, C-13 compliant).
func TestGetLatestTrade_Success(t *testing.T) {
	var gotPath, gotFeed string
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotFeed = r.URL.Query().Get("feed")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"symbol": "CAPR",
			"trade": map[string]interface{}{
				"t": "2024-01-02T15:30:00Z",
				"p": 12.34,
				"s": int32(50),
				"x": "V",
			},
		})
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL})
	price, ts, err := c.GetLatestTrade(context.Background(), "CAPR")
	if err != nil {
		t.Fatalf("GetLatestTrade failed: %v", err)
	}
	if price != 12.34 {
		t.Errorf("expected price 12.34, got %f", price)
	}
	if want := "2024-01-02T15:30:00Z"; ts.UTC().Format(time.RFC3339) != want {
		t.Errorf("expected trade time %s, got %s", want, ts.UTC().Format(time.RFC3339))
	}
	if gotPath != "/v2/stocks/CAPR/trades/latest" {
		t.Errorf("unexpected path %q", gotPath)
	}
	if gotFeed != "iex" {
		t.Errorf("expected feed=iex default, got %q", gotFeed)
	}
}

func TestGetLatestTrade_HTTPError(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"symbol not found"}`))
	})
	defer srv.Close()

	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", DataURL: srv.URL})
	if _, _, err := c.GetLatestTrade(context.Background(), "UNKNOWN"); err == nil {
		t.Fatal("expected error for 404 response, got nil")
	}
}

// feature 211: cash-dividend corporate-actions feed.
func TestGetCashDividends_Success(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"corporate_actions":{"cash_dividends":[
			{"symbol":"AAPL","ex_date":"2024-08-12","payable_date":"2024-08-15","rate":0.25},
			{"symbol":"AAPL","ex_date":"2025-02-10","payable_date":"2025-02-13","rate":0.26}
		]},"next_page_token":null}`))
	})
	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", APISecret: "s", DataURL: srv.URL})
	divs, err := c.GetCashDividends(context.Background(), "AAPL",
		time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2025, 6, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("GetCashDividends: %v", err)
	}
	if len(divs) != 2 {
		t.Fatalf("got %d dividends, want 2", len(divs))
	}
	if got := divs[0].ExDate.Format("2006-01-02"); got != "2024-08-12" {
		t.Errorf("ex_date = %s, want 2024-08-12", got)
	}
	if divs[0].CashAmount != 0.25 {
		t.Errorf("cash_amount = %v, want 0.25", divs[0].CashAmount)
	}
	if divs[0].Currency != "USD" {
		t.Errorf("currency = %q, want USD", divs[0].Currency)
	}
	if divs[0].PayDate == nil || divs[0].PayDate.Format("2006-01-02") != "2024-08-15" {
		t.Errorf("pay_date = %v, want 2024-08-15", divs[0].PayDate)
	}
}

// An unentitled plan / server error surfaces as an error so the caller degrades yield to missing.
func TestGetCashDividends_HTTPError(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"message":"forbidden"}`))
	})
	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", APISecret: "s", DataURL: srv.URL})
	if _, err := c.GetCashDividends(context.Background(), "AAPL",
		time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), time.Now()); err == nil {
		t.Fatal("expected error on 403 (unentitled), got nil")
	}
}

// ── feature 294: vendor request metrics at do() ─────────────────────────────

// No t.Parallel() for these tests: they swap the process-global MeterProvider.
func vendorMetricReader(t *testing.T) *sdkmetric.ManualReader {
	t.Helper()
	prev := otel.GetMeterProvider()
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	otel.SetMeterProvider(mp)
	t.Cleanup(func() {
		otel.SetMeterProvider(prev)
		_ = mp.Shutdown(context.Background())
	})
	return reader
}

// vendorMetrics holds marketdata.vendor.requests keyed "vendor/op/outcome", duration sample counts
// keyed "vendor/op", and every attribute value seen on either instrument.
type vendorMetrics struct {
	requests   map[string]int64
	durations  map[string]uint64
	attrValues []string
}

func collectVendorMetrics(t *testing.T, reader *sdkmetric.ManualReader) vendorMetrics {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	out := vendorMetrics{requests: map[string]int64{}, durations: map[string]uint64{}}
	key := func(set attribute.Set, keys ...string) string {
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			v, _ := set.Value(attribute.Key(k))
			parts = append(parts, v.AsString())
		}
		for _, kv := range set.ToSlice() {
			out.attrValues = append(out.attrValues, kv.Value.String())
		}
		return strings.Join(parts, "/")
	}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			switch d := m.Data.(type) {
			case metricdata.Sum[int64]:
				if m.Name == "marketdata.vendor.requests" {
					for _, dp := range d.DataPoints {
						out.requests[key(dp.Attributes, "vendor", "op", "outcome")] += dp.Value
					}
				}
			case metricdata.Histogram[float64]:
				if m.Name == "marketdata.vendor.request.duration" {
					for _, dp := range d.DataPoints {
						out.durations[key(dp.Attributes, "vendor", "op")] += dp.Count
					}
				}
			}
		}
	}
	return out
}

func assertNoAttrContains(t *testing.T, got vendorMetrics, banned ...string) {
	t.Helper()
	for _, v := range got.attrValues {
		for _, b := range banned {
			if strings.Contains(v, b) {
				t.Fatalf("metric attribute %q contains %q", v, b)
			}
		}
	}
}

// @AC-13 (Alpaca): a 2xx latest-quote call counts ok with one duration sample, and the symbol in the
// request path never becomes a label.
func TestDo_RecordsOKOutcome_AC13(t *testing.T) {
	reader := vendorMetricReader(t)
	srv := makeTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"quote":{"t":"2024-01-02T10:00:00Z","ap":1,"bp":1}}`))
	})
	defer srv.Close()
	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "SECRET123", APISecret: "s", DataURL: srv.URL})
	if _, err := c.GetLatestQuote(context.Background(), "AAPL"); err != nil {
		t.Fatalf("GetLatestQuote: %v", err)
	}
	got := collectVendorMetrics(t, reader)
	if n := got.requests["alpaca/quotes_latest/ok"]; n != 1 {
		t.Fatalf("vendor.requests{alpaca,quotes_latest,ok} = %d, want 1 (%v)", n, got.requests)
	}
	if n := got.durations["alpaca/quotes_latest"]; n != 1 {
		t.Fatalf("vendor.request.duration{alpaca,quotes_latest} samples = %d, want 1", n)
	}
	assertNoAttrContains(t, got, "AAPL", "SECRET123", srv.URL)
}

// @AC-13 (Alpaca): a request whose context ends before the response counts ctx, not transport.
func TestDo_RecordsCtxOutcome_AC13(t *testing.T) {
	reader := vendorMetricReader(t)
	srv := makeTestServer(t, func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	defer srv.Close()
	c := alpaca.NewClient(alpaca.ClientConfig{APIKey: "k", APISecret: "s", DataURL: srv.URL})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := c.GetLatestQuote(ctx, "AAPL"); err == nil {
		t.Fatal("expected an error after the context deadline")
	}
	got := collectVendorMetrics(t, reader)
	if n := got.requests["alpaca/quotes_latest/ctx"]; n != 1 {
		t.Fatalf("vendor.requests{alpaca,quotes_latest,ctx} = %d, want 1 (%v)", n, got.requests)
	}
	if n := got.requests["alpaca/quotes_latest/transport"]; n != 0 {
		t.Fatalf("vendor.requests{alpaca,quotes_latest,transport} = %d, want 0", n)
	}
}

// @AC-32 row 1: rate_limit_rps 200 → 50 resizes the existing client's limiter on its next request.
func TestLiveClient_RateLimitFollowsSettings_AC32(t *testing.T) {
	srv := makeTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"bars": []interface{}{}, "next_page_token": ""})
	})
	defer srv.Close()

	var mu sync.Mutex
	cur := alpaca.Settings{APIKey: "k", DataURL: srv.URL, RateLimitRPS: 200}
	c := alpaca.NewLiveClient(func() alpaca.Settings {
		mu.Lock()
		defer mu.Unlock()
		return cur
	}, true)
	bars := func() {
		t.Helper()
		if _, err := c.GetBars(context.Background(), "AAPL", "1Day", time.Now().Add(-24*time.Hour), time.Now()); err != nil {
			t.Fatalf("GetBars failed: %v", err)
		}
	}

	bars()
	if got := c.Limit(); got != rate.Limit(200) {
		t.Fatalf("Limit() = %v after the first request, want 200", got)
	}
	mu.Lock()
	cur.RateLimitRPS = 50
	mu.Unlock()
	bars()
	if got := c.Limit(); got != rate.Limit(50) {
		t.Fatalf("Limit() = %v after the next request, want 50", got)
	}
}

// ── feature 347: adaptive rate limit at do() ────────────────────────────────

const (
	f347DataHost    = "data.alpaca.markets"
	f347TradingHost = "paper-api.alpaca.markets"
	f347APIKey      = "KEY-F347"
	f347BarsBody    = `{"bars":[{"t":"2024-01-02T10:00:00Z","o":1,"h":1,"l":1,"c":1,"v":1}],"next_page_token":""}`
	f347QuoteBody   = `{"quote":{"t":"2024-01-02T10:00:00Z","ap":1,"bp":1}}`
)

var f347Start = time.Unix(1_800_000_000, 0)

// f347Clock is the client clock; advance=false keeps every request "at the same moment".
type f347Clock struct {
	mu      sync.Mutex
	now     time.Time
	advance bool
	sleeps  []time.Duration
}

func (c *f347Clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *f347Clock) Sleep(ctx context.Context, d time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sleeps = append(c.sleeps, d)
	if c.advance {
		c.now = c.now.Add(d)
	}
	return nil
}

func (c *f347Clock) recorded() []time.Duration {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]time.Duration(nil), c.sleeps...)
}

type f347Attempt struct {
	host, path string
	at         time.Time
}

// f347RT answers from a script and keeps the request's real Alpaca host.
type f347RT struct {
	mu       sync.Mutex
	now      func() time.Time
	attempts []f347Attempt
	respond  func(n int, req *http.Request) *http.Response
}

func (rt *f347RT) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.mu.Lock()
	n := len(rt.attempts)
	rt.attempts = append(rt.attempts, f347Attempt{host: req.URL.Host, path: req.URL.Path, at: rt.now()})
	rt.mu.Unlock()
	return rt.respond(n, req), nil
}

func (rt *f347RT) seen() []f347Attempt {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return append([]f347Attempt(nil), rt.attempts...)
}

func f347Resp(status int, body string, headers ...string) *http.Response {
	h := http.Header{}
	for i := 0; i+1 < len(headers); i += 2 {
		h.Set(headers[i], headers[i+1])
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: h}
}

func f347RateHeaders(limit, remaining int, reset time.Time) []string {
	return []string{
		"X-RateLimit-Limit", strconv.Itoa(limit),
		"X-RateLimit-Remaining", strconv.Itoa(remaining),
		"X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10),
	}
}

func f347ResetOnly(reset time.Time) []string {
	return []string{"X-RateLimit-Reset", strconv.FormatInt(reset.Unix(), 10)}
}

// f347Client builds a live client behind rt. A nil clock keeps the real clock and sleep.
func f347Client(rt *f347RT, clock *f347Clock, jitter time.Duration, edit func(*alpaca.Settings)) *alpaca.Client {
	s := alpaca.Settings{
		APIKey: f347APIKey, APISecret: "s", BaseURL: "https://" + f347TradingHost, DataURL: "https://" + f347DataHost,
		AdaptiveRateLimit: true,
	}
	if edit != nil {
		edit(&s)
	}
	c := alpaca.NewLiveClient(func() alpaca.Settings { return s }, true)
	alpaca.SetTransport(c, rt)
	alpaca.SetJitter(c, func() time.Duration { return jitter })
	rt.now = time.Now
	if clock != nil {
		alpaca.SetNow(c, clock.Now)
		alpaca.SetSleep(c, clock.Sleep)
		rt.now = clock.Now
	}
	return c
}

func f347Bars(ctx context.Context, c *alpaca.Client, symbol string) (int, error) {
	bars, err := c.GetBars(ctx, symbol, "1Day", f347Start.Add(-24*time.Hour), f347Start)
	return len(bars), err
}

func f347Deadline(t *testing.T, d time.Duration) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	t.Cleanup(cancel)
	return ctx
}

type f347Warn struct {
	msg   string
	attrs map[string]string
}

type f347WarnHandler struct {
	mu    *sync.Mutex
	warns *[]f347Warn
}

func (h f347WarnHandler) Enabled(_ context.Context, l slog.Level) bool { return l >= slog.LevelWarn }
func (h f347WarnHandler) WithAttrs([]slog.Attr) slog.Handler           { return h }
func (h f347WarnHandler) WithGroup(string) slog.Handler                { return h }
func (h f347WarnHandler) Handle(_ context.Context, r slog.Record) error {
	w := f347Warn{msg: r.Message, attrs: map[string]string{}}
	r.Attrs(func(a slog.Attr) bool {
		w.attrs[a.Key] = a.Value.String()
		return true
	})
	h.mu.Lock()
	defer h.mu.Unlock()
	*h.warns = append(*h.warns, w)
	return nil
}

func f347RecordWarns(t *testing.T) func() []f347Warn {
	t.Helper()
	var mu sync.Mutex
	var warns []f347Warn
	prev := slog.Default()
	slog.SetDefault(slog.New(f347WarnHandler{mu: &mu, warns: &warns}))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return func() []f347Warn {
		mu.Lock()
		defer mu.Unlock()
		return append([]f347Warn(nil), warns...)
	}
}

func f347WantRateLimited(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected a rate-limited error, got nil")
	}
	for _, want := range []string{"rate limited", f347DataHost} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q does not contain %q", err, want)
		}
	}
}

// @AC-1: an exhausted window holds the next request until the reset time.
func TestDoPaced_ExhaustedWindowHoldsUntilReset_F347_AC1(t *testing.T) {
	clock := &f347Clock{now: f347Start, advance: true}
	reset := f347Start.Add(3 * time.Second)
	rt := &f347RT{respond: func(n int, _ *http.Request) *http.Response {
		if n == 0 {
			return f347Resp(200, f347BarsBody, f347RateHeaders(200, 0, reset)...)
		}
		return f347Resp(200, f347BarsBody)
	}}
	c := f347Client(rt, clock, 0, nil)
	if _, err := f347Bars(context.Background(), c, "MSFT"); err != nil {
		t.Fatalf("priming request: %v", err)
	}
	n, err := f347Bars(f347Deadline(t, 30*time.Second), c, "AAPL")
	if err != nil || n != 1 {
		t.Fatalf("bars = %d, err = %v; want 1 bar and no error", n, err)
	}
	if got := rt.seen()[1].at; got.Before(reset) {
		t.Fatalf("request sent %v before the reset", reset.Sub(got))
	}
}

// @AC-2 (guard): hosts are tracked independently. Red under a "key by credential only" mutant.
func TestDoPaced_HostsAreIndependent_F347_AC2(t *testing.T) {
	clock := &f347Clock{now: f347Start, advance: true}
	rt := &f347RT{respond: func(_ int, req *http.Request) *http.Response {
		if req.URL.Host == f347DataHost {
			return f347Resp(200, f347BarsBody, f347RateHeaders(200, 0, f347Start.Add(5*time.Second))...)
		}
		return f347Resp(200, `[]`, f347RateHeaders(200, 150, f347Start.Add(30*time.Second))...)
	}}
	c := f347Client(rt, clock, 0, nil)
	if _, err := f347Bars(context.Background(), c, "AAPL"); err != nil {
		t.Fatalf("data-host priming request: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := c.ListAssets(context.Background(), "us_equity"); err != nil {
			t.Fatalf("assets request %d: %v", i+1, err)
		}
	}
	if sleeps := clock.recorded(); len(sleeps) != 0 {
		t.Fatalf("assets request waited %v for the data host's reset", sleeps)
	}
	if got := rt.seen(); len(got) != 3 || got[2].host != f347TradingHost {
		t.Fatalf("attempts = %+v, want the third on %s", got, f347TradingHost)
	}
}

// @AC-3: a low remaining count spreads requests instead of bursting.
func TestDoPaced_LowRemainingSpreadsRequests_F347_AC3(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	rt := &f347RT{respond: func(n int, _ *http.Request) *http.Response {
		if n == 0 {
			return f347Resp(200, f347BarsBody, f347RateHeaders(200, 4, f347Start.Add(4*time.Second))...)
		}
		return f347Resp(200, f347BarsBody)
	}}
	c := f347Client(rt, clock, 100*time.Millisecond, nil)
	if _, err := f347Bars(context.Background(), c, "MSFT"); err != nil {
		t.Fatalf("priming request: %v", err)
	}
	for i := 0; i < 4; i++ {
		if _, err := f347Bars(f347Deadline(t, 30*time.Second), c, "AAPL"); err != nil {
			t.Fatalf("request %d: %v", i+1, err)
		}
	}
	sleeps := clock.recorded()
	if len(sleeps) != 3 {
		t.Fatalf("waits = %v, want the first request unwaited and three waits", sleeps)
	}
	for i, min := range []time.Duration{time.Second, 2 * time.Second, 3 * time.Second} {
		if sleeps[i] < min || sleeps[i] >= 4*time.Second {
			t.Fatalf("wait %d = %v, want >= %v and before the reset", i+2, sleeps[i], min)
		}
	}
}

// @AC-4: a 429 is retried after the reset and the caller sees success.
func TestDoPaced_RetriesA429AfterReset_F347_AC4(t *testing.T) {
	clock := &f347Clock{now: f347Start, advance: true}
	reset := f347Start.Add(2 * time.Second)
	threeBars := `{"bars":[{"t":"2024-01-02T10:00:00Z"},{"t":"2024-01-03T10:00:00Z"},{"t":"2024-01-04T10:00:00Z"}],"next_page_token":""}`
	rt := &f347RT{respond: func(n int, _ *http.Request) *http.Response {
		if n == 0 {
			return f347Resp(429, `{"message":"too many requests"}`, f347ResetOnly(reset)...)
		}
		return f347Resp(200, threeBars)
	}}
	c := f347Client(rt, clock, 0, nil)
	n, err := f347Bars(f347Deadline(t, 30*time.Second), c, "MSFT")
	if err != nil || n != 3 {
		t.Fatalf("bars = %d, err = %v; want 3 bars and no error", n, err)
	}
	got := rt.seen()
	if len(got) != 2 || got[1].at.Before(reset) {
		t.Fatalf("attempts = %+v, want a second attempt no earlier than the reset", got)
	}
}

// @AC-5: a 429 without a reset header backs off exponentially, jitter added.
func TestDoPaced_BacksOffWithoutReset_F347_AC5(t *testing.T) {
	const jitter = 250 * time.Millisecond
	clock := &f347Clock{now: f347Start, advance: true}
	rt := &f347RT{respond: func(n int, _ *http.Request) *http.Response {
		if n < 3 {
			return f347Resp(429, `{}`)
		}
		return f347Resp(200, f347BarsBody)
	}}
	c := f347Client(rt, clock, jitter, nil)
	if _, err := f347Bars(f347Deadline(t, 60*time.Second), c, "AAPL"); err != nil {
		t.Fatalf("GetBars: %v", err)
	}
	want := []time.Duration{time.Second + jitter, 2*time.Second + jitter, 4*time.Second + jitter}
	sleeps := clock.recorded()
	if len(sleeps) != len(want) {
		t.Fatalf("waits = %v, want %v", sleeps, want)
	}
	for i := range want {
		if sleeps[i] != want[i] {
			t.Fatalf("wait before attempt %d = %v, want backoff plus jitter %v", i+2, sleeps[i], want[i])
		}
	}
}

// @AC-6: retries stop at the caller's deadline.
func TestDoPaced_RetriesStopAtDeadline_F347_AC6(t *testing.T) {
	rt := &f347RT{respond: func(int, *http.Request) *http.Response {
		return f347Resp(429, `{}`, f347ResetOnly(time.Now().Add(10*time.Second))...)
	}}
	c := f347Client(rt, nil, 0, nil)
	began := time.Now()
	_, err := c.GetLatestQuote(f347Deadline(t, 2500*time.Millisecond), "NVDA")
	if took := time.Since(began); took > 3*time.Second {
		t.Fatalf("returned after %v, want within 3 s", took)
	}
	f347WantRateLimited(t, err)
}

// @AC-7 (guard): the static ceiling still caps the rate. Red under a "skip the static limiter when adaptive" mutant.
func TestDoPaced_StaticCeilingStillCaps_F347_AC7(t *testing.T) {
	rt := &f347RT{respond: func(int, *http.Request) *http.Response {
		return f347Resp(200, f347BarsBody, f347RateHeaders(10000, 10000, time.Now().Add(60*time.Second))...)
	}}
	c := f347Client(rt, nil, 0, func(s *alpaca.Settings) { s.RateLimitRPS = 5 })
	var wg sync.WaitGroup
	for i := 0; i < 15; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := f347Bars(context.Background(), c, "AAPL"); err != nil {
				t.Errorf("GetBars: %v", err)
			}
		}()
	}
	wg.Wait()
	got := rt.seen()
	if len(got) != 15 {
		t.Fatalf("attempts = %d, want 15", len(got))
	}
	sort.Slice(got, func(i, j int) bool { return got[i].at.Before(got[j].at) })
	const tolerance = 100 * time.Millisecond
	atOnce := 0
	for _, a := range got {
		if a.at.Sub(got[0].at) < tolerance {
			atOnce++
		}
	}
	if atOnce != 5 {
		t.Fatalf("%d requests sent at once, want exactly 5", atOnce)
	}
	if d := got[9].at.Sub(got[0].at); d < time.Second-tolerance {
		t.Fatalf("10th request sent %v after the first, want >= 1.0 s", d)
	}
	if d := got[14].at.Sub(got[0].at); d < 2*time.Second-tolerance {
		t.Fatalf("15th request sent %v after the first, want >= 2.0 s", d)
	}
}

// @AC-8 (guard): missing or malformed headers change nothing. Red under a "missing header reads as Remaining 0" mutant.
func TestDoPaced_UnusableHeadersChangeNothing_F347_AC8(t *testing.T) {
	clock := &f347Clock{now: f347Start, advance: true}
	rt := &f347RT{respond: func(n int, _ *http.Request) *http.Response {
		switch n {
		case 1:
			return f347Resp(200, f347BarsBody, "X-RateLimit-Remaining", "abc")
		case 2:
			return f347Resp(200, f347BarsBody, "X-RateLimit-Remaining", "0")
		}
		return f347Resp(200, f347BarsBody)
	}}
	c := f347Client(rt, clock, 0, nil)
	for i := 0; i < 4; i++ {
		if n, err := f347Bars(context.Background(), c, "AAPL"); err != nil || n != 1 {
			t.Fatalf("request %d: bars = %d, err = %v", i+1, n, err)
		}
	}
	if sleeps := clock.recorded(); len(sleeps) != 0 {
		t.Fatalf("a request was delayed: %v", sleeps)
	}
}

// @AC-9 (guard): the kill switch restores the single attempt. Red under an "ignore the switch" mutant.
func TestDo_KillSwitchOffIsASingleAttempt_F347_AC9(t *testing.T) {
	rt := &f347RT{respond: func(int, *http.Request) *http.Response {
		return f347Resp(429, `{}`, f347ResetOnly(time.Now().Add(2*time.Second))...)
	}}
	c := f347Client(rt, nil, 0, func(s *alpaca.Settings) { s.AdaptiveRateLimit = false })
	began := time.Now()
	_, err := f347Bars(f347Deadline(t, 30*time.Second), c, "AAPL")
	if err == nil || !strings.HasPrefix(err.Error(), "alpaca bars 429") {
		t.Fatalf("error = %v, want one starting with \"alpaca bars 429\"", err)
	}
	if took := time.Since(began); took > time.Second {
		t.Fatalf("returned after %v, want within 1 s", took)
	}
	if n := len(rt.seen()); n != 1 {
		t.Fatalf("attempts = %d, want exactly 1", n)
	}
}

// @AC-14: throttling is visible in telemetry and logs.
func TestDoPaced_ThrottleIsObservable_F347_AC14(t *testing.T) {
	reader := vendorMetricReader(t)
	warns := f347RecordWarns(t)
	clock := &f347Clock{now: f347Start, advance: true}
	rt := &f347RT{respond: func(n int, _ *http.Request) *http.Response {
		if n == 0 {
			return f347Resp(429, `{}`, f347ResetOnly(f347Start.Add(2*time.Second))...)
		}
		return f347Resp(200, f347BarsBody)
	}}
	c := f347Client(rt, clock, 0, nil)
	if _, err := f347Bars(f347Deadline(t, 30*time.Second), c, "AAPL"); err != nil {
		t.Fatalf("GetBars: %v", err)
	}
	got := collectVendorMetrics(t, reader)
	if got.requests["alpaca/bars/http_429"] != 1 || got.requests["alpaca/bars/ok"] != 1 {
		t.Fatalf("vendor.requests = %v, want one http_429 and one ok for alpaca/bars", got.requests)
	}
	assertNoAttrContains(t, got, f347APIKey, "AAPL", f347DataHost)
	logged := warns()
	if len(logged) != 1 {
		t.Fatalf("WARN logs = %+v, want exactly one", logged)
	}
	if logged[0].attrs["host"] != f347DataHost || logged[0].attrs["wait_ms"] != "2000" {
		t.Fatalf("WARN attrs = %v, want host %s and wait_ms 2000", logged[0].attrs, f347DataHost)
	}
	for k, v := range logged[0].attrs {
		if strings.Contains(v, f347APIKey) {
			t.Fatalf("WARN attr %s carries the API key", k)
		}
	}
}

// @AC-19: retries are bounded when the caller has no deadline.
func TestDoPaced_NoDeadlineIsBounded_F347_AC19(t *testing.T) {
	reader := vendorMetricReader(t)
	clock := &f347Clock{now: f347Start, advance: true}
	rt := &f347RT{respond: func(int, *http.Request) *http.Response {
		return f347Resp(429, `{}`, f347ResetOnly(clock.Now().Add(3600*time.Second))...)
	}}
	c := f347Client(rt, clock, 0, nil)
	_, err := f347Bars(context.Background(), c, "AAPL")
	f347WantRateLimited(t, err)
	got := rt.seen()
	if len(got) != 2 || got[1].at.Sub(got[0].at) < 60*time.Second {
		t.Fatalf("attempts = %+v, want exactly 2 with the second >= 60 s after the first", got)
	}
	if took := clock.Now().Sub(f347Start); took > 90*time.Second {
		t.Fatalf("returned %v after the call began on the client clock, want <= 90 s", took)
	}
	m := collectVendorMetrics(t, reader)
	if m.requests["alpaca/bars/http_429"] != 2 || m.requests["alpaca/bars/throttle"] != 1 {
		t.Fatalf("vendor.requests = %v, want 2 http_429 and 1 throttle", m.requests)
	}
	if m.durations["alpaca/bars"] != 2 {
		t.Fatalf("duration samples = %d, want 2 (the throttle point has none)", m.durations["alpaca/bars"])
	}
}

// @AC-21: a wait ended by the request context is recorded as ctx.
func TestDoPaced_WaitEndedByContextIsCtx_F347_AC21(t *testing.T) {
	for name, tc := range map[string]struct {
		cancelAfter time.Duration
		want        error
	}{
		"the deadline passes":               {want: context.DeadlineExceeded},
		"the caller cancels after 1 second": {cancelAfter: time.Second, want: context.Canceled},
	} {
		t.Run(name, func(t *testing.T) {
			reader := vendorMetricReader(t)
			rt := &f347RT{respond: func(n int, _ *http.Request) *http.Response {
				if n == 0 {
					return f347Resp(200, f347BarsBody, f347RateHeaders(200, 0, time.Now().Add(10*time.Second))...)
				}
				return f347Resp(200, f347QuoteBody)
			}}
			c := f347Client(rt, nil, 0, nil)
			if _, err := f347Bars(context.Background(), c, "MSFT"); err != nil {
				t.Fatalf("priming request: %v", err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
			defer cancel()
			if tc.cancelAfter > 0 {
				time.AfterFunc(tc.cancelAfter, cancel)
			}
			_, err := c.GetLatestQuote(ctx, "NVDA")
			f347WantRateLimited(t, err)
			if !errors.Is(err, tc.want) {
				t.Fatalf("error %q does not wrap %v", err, tc.want)
			}
			for _, a := range rt.seen() {
				if strings.Contains(a.path, "NVDA") {
					t.Fatalf("a request for NVDA reached the data host: %+v", a)
				}
			}
			m := collectVendorMetrics(t, reader)
			if m.requests["alpaca/quotes_latest/ctx"] != 1 || m.durations["alpaca/quotes_latest"] != 0 {
				t.Fatalf("requests = %v, durations = %v; want exactly one quotes_latest ctx point and no duration", m.requests, m.durations)
			}
			for k, n := range m.requests {
				if strings.HasPrefix(k, "alpaca/quotes_latest/") && k != "alpaca/quotes_latest/ctx" && n != 0 {
					t.Fatalf("unexpected point %s = %d", k, n)
				}
			}
		})
	}
}

// @AC-22: a zero static ceiling disables only the ceiling.
func TestDoPaced_ZeroCeilingKeepsPacing_F347_AC22(t *testing.T) {
	clock := &f347Clock{now: f347Start, advance: true}
	reset := f347Start.Add(3 * time.Second)
	rt := &f347RT{respond: func(n int, _ *http.Request) *http.Response {
		if n == 0 {
			return f347Resp(200, f347BarsBody, f347RateHeaders(200, 0, reset)...)
		}
		return f347Resp(200, f347BarsBody)
	}}
	c := f347Client(rt, clock, 0, func(s *alpaca.Settings) { s.RateLimitRPS = 0 })
	if _, err := f347Bars(context.Background(), c, "MSFT"); err != nil {
		t.Fatalf("priming request: %v", err)
	}
	if _, err := f347Bars(f347Deadline(t, 30*time.Second), c, "AAPL"); err != nil {
		t.Fatalf("GetBars: %v", err)
	}
	if got := rt.seen()[1].at; got.Before(reset) {
		t.Fatalf("request sent %v before the reset", reset.Sub(got))
	}
}

// @AC-24 (guard): a caller that cannot wait for its spread slot is sent at once. Red under a
// "refuse a caller that cannot wait for its slot" mutant (R-9).
func TestDoPaced_ShortDeadlineSkipsItsSlot_F347_AC24(t *testing.T) {
	clock := &f347Clock{now: f347Start}
	rt := &f347RT{respond: func(n int, req *http.Request) *http.Response {
		if n == 0 {
			return f347Resp(200, f347BarsBody, f347RateHeaders(200, 4, f347Start.Add(4*time.Second))...)
		}
		if strings.HasSuffix(req.URL.Path, "/quotes/latest") {
			return f347Resp(200, f347QuoteBody)
		}
		return f347Resp(200, f347BarsBody)
	}}
	c := f347Client(rt, clock, 0, nil)
	if _, err := f347Bars(context.Background(), c, "MSFT"); err != nil {
		t.Fatalf("priming request: %v", err)
	}
	if _, err := f347Bars(f347Deadline(t, 30*time.Second), c, "AAPL"); err != nil {
		t.Fatalf("first-slot request: %v", err)
	}
	if _, err := c.GetLatestQuote(f347Deadline(t, 500*time.Millisecond), "NVDA"); err != nil {
		t.Fatalf("GetLatestQuote: %v", err)
	}
	if sleeps := clock.recorded(); len(sleeps) != 0 {
		t.Fatalf("the NVDA request waited: %v", sleeps)
	}
	if got := rt.seen(); len(got) != 3 || !strings.Contains(got[2].path, "NVDA") {
		t.Fatalf("attempts = %+v, want the NVDA request sent third", got)
	}
}

// A static ceiling that cannot fit the caller's deadline is a rate-limit refusal, recorded as ctx.
func TestDoPaced_StaticCeilingRefusal_F347(t *testing.T) {
	reader := vendorMetricReader(t)
	rt := &f347RT{respond: func(int, *http.Request) *http.Response { return f347Resp(200, f347BarsBody) }}
	c := f347Client(rt, nil, 0, func(s *alpaca.Settings) { s.RateLimitRPS = 1 })
	if _, err := f347Bars(context.Background(), c, "AAPL"); err != nil {
		t.Fatalf("first request: %v", err)
	}
	expired, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	_, err := f347Bars(expired, c, "AAPL")
	f347WantRateLimited(t, err)
	if n := len(rt.seen()); n != 1 {
		t.Fatalf("attempts = %d, want the refused request never sent", n)
	}
	if m := collectVendorMetrics(t, reader); m.requests["alpaca/bars/ctx"] != 1 {
		t.Fatalf("vendor.requests = %v, want one alpaca/bars ctx point", m.requests)
	}
}
