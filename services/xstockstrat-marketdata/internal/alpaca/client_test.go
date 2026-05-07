package alpaca_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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
